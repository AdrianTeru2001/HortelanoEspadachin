// ============================================================
// rutas/auth.js — Registro, inicio de sesión y aprobaciones
// ------------------------------------------------------------
// "Rutas" = las URLs que el navegador puede visitar.
//
//   POST /auth/registro       → cuando alguien se registra
//   POST /auth/login          → cuando alguien inicia sesión
//   POST /auth/logout         → cuando alguien sale
//   POST /auth/volver-a-pedir → un rechazado pide entrar otra vez
//   POST /auth/aprobar        → SOLO tú: apruebas a un amigo
//   POST /auth/rechazar       → SOLO tú: rechazas o revocas
// ============================================================

const express = require('express');
const bcrypt = require('bcryptjs');

const { db, consultas, contarAdmins } = require('../base-datos');

const router = express.Router();

// ------------------------------------------------------------
// REGISTRO
// ------------------------------------------------------------
// Flujo:
//   1. Recogemos nombre, email y contraseña del formulario
//   2. Comprobamos que no haya datos vacíos ni repetidos
//   3. Ciframos la contraseña con bcrypt (nunca guardamos el texto)
//   4. Creamos el usuario con estado 'pendiente'
//      → EXCEPTO el primer usuario, que será el administrador
// ------------------------------------------------------------
router.post('/registro', (req, res) => {
  const { nombre, email, contrasena, repetir } = req.body;

  const fallo = (mensaje) =>
    res.redirect('/registro?error=' + encodeURIComponent(mensaje));

  // --- Comprobaciones de seguridad ---
  if (!nombre || !email || !contrasena) {
    return fallo('Rellena todos los campos.');
  }
  if (nombre.length < 3) {
    return fallo('El nombre de usuario necesita al menos 3 caracteres.');
  }
  if (contrasena.length < 6) {
    return fallo('La contraseña necesita al menos 6 caracteres.');
  }
  if (contrasena !== repetir) {
    return fallo('Las contraseñas no coinciden.');
  }

  // ¿Ya existe alguien con ese nombre o email?
  if (consultas.usuarioPorNombre.get(nombre)) {
    return fallo('Ese nombre de usuario ya está en uso.');
  }
  const emailExiste = db
    .prepare('SELECT 1 FROM usuarios WHERE email = ?')
    .get(email);
  if (emailExiste) {
    return fallo('Ese correo ya está registrado.');
  }

  // --- ¿Es el primer usuario de todo el sistema? → será admin ---
  const esPrimerUsuario = contarAdmins() === 0;
  const esAdmin = esPrimerUsuario ? 1 : 0;
  // Si eres admin, entras directo (no tiene sentido autorizarte a ti mismo)
  const estado = esAdmin ? 'aprobado' : 'pendiente';

  // --- Ciframos la contraseña ---
  // bcrypt genera un "salt" (ruido aleatorio) y lo mezcla con la
  // contraseña. El resultado es un texto ilegible. Si alguien
  // roba la base de datos, no podrá leer las contraseñas.
  const hash = bcrypt.hashSync(contrasena, 10);

  try {
    const resultado = consultas.crearUsuario.run({
      nombre,
      email,
      contrasena_hash: hash,
      es_admin: esAdmin,
      estado,
    });

    // Guardamos en la sesión que ya está dentro
    req.session.usuarioId = resultado.lastInsertRowid;

    if (esAdmin) {
      // Primer usuario: le damos la bienvenida como dueño
      return res.redirect('/panel?bienvenida=1');
    }
    // Cualquier otro: a la pantalla de espera
    return res.redirect('/esperando');
  } catch (err) {
    console.error(err);
    return fallo('No se pudo crear el usuario. Prueba con otro nombre.');
  }
});

// ------------------------------------------------------------
// INICIO DE SESIÓN
// ------------------------------------------------------------
router.post('/login', (req, res) => {
  const { nombre, contrasena } = req.body;

  const fallo = (mensaje) =>
    res.redirect('/login?error=' + encodeURIComponent(mensaje));

  if (!nombre || !contrasena) {
    return fallo('Rellena todos los campos.');
  }

  const usuario = consultas.usuarioPorNombre.get(nombre);
  if (!usuario) {
    // Mensaje genérico a propósito: no revelamos si el usuario existe
    return fallo('Usuario o contraseña incorrectos.');
  }

  // Comparamos la contraseña escrita con el hash guardado
  const correcta = bcrypt.compareSync(contrasena, usuario.contrasena_hash);
  if (!correcta) {
    return fallo('Usuario o contraseña incorrectos.');
  }

  // --- Seguimos según su estado ---
  if (usuario.estado === 'pendiente') {
    req.session.usuarioId = usuario.id;
    return res.redirect('/esperando');
  }
  if (usuario.estado === 'rechazado') {
    // Sí le dejamos entrar (con sesión), pero solo hasta la
    // pantalla de rechazo, donde podrá "volver a pedir acceso"
    req.session.usuarioId = usuario.id;
    return res.redirect('/esperando');
  }

  // ¡Aprobado! Le abrimos la sesión y le mandamos al inicio
  req.session.usuarioId = usuario.id;
  return res.redirect('/');
});

// ------------------------------------------------------------
// CERRAR SESIÓN
// ------------------------------------------------------------
router.post('/logout', (req, res) => {
  // Borrar la cookie de sesión = "descolgamos" al usuario
  req.session = null;
  res.redirect('/login');
});

// ------------------------------------------------------------
// VOLVER A PEDIR ACCESO (el propio usuario, sin ser admin)
// ------------------------------------------------------------
// Si a alguien lo rechazaron sin querer, o cambió de opinión,
// puede pulsar este botón y su estado vuelve a 'pendiente'.
// Entonces aparecerá otra vez en tu lista del panel.
// ------------------------------------------------------------
router.post('/volver-a-pedir', (req, res) => {
  // Solo quien tiene la sesión puede cambiar su propio estado
  if (!req.session.usuarioId) {
    return res.redirect('/login');
  }

  const usuario = consultas.usuarioPorId.get(req.session.usuarioId);
  if (!usuario) return res.redirect('/login');

  // Si ya está aprobado o pendiente, no hay nada que pedir
  if (usuario.estado !== 'rechazado') {
    return res.redirect(usuario.estado === 'aprobado' ? '/' : '/esperando');
  }

  // Volvemos a ponerlo en cola de espera
  consultas.cambiarEstadoUsuario.run('pendiente', usuario.id);
  return res.redirect('/esperando?aviso=solicitud-enviada');
});

// ------------------------------------------------------------
// APROBAR / RECHAZAR (solo el administrador)
// ------------------------------------------------------------
// Comprobamos que quien hace esto sea el admin. Si no, 403.
// Nota: sirve para CUALQUIER estado, así el admin puede
// corregir un error (aprobar a alguien rechazado) o revocar
// el acceso de alguien que ya estaba aprobado.
// ------------------------------------------------------------
function soloAdmin(req, res) {
  if (!req.usuario || !req.usuario.es_admin) {
    res.status(403).send('Solo el administrador puede hacer esto.');
    return false;
  }
  return true;
}

router.post('/aprobar', (req, res) => {
  if (!soloAdmin(req, res)) return;
  const { id } = req.body;

  const objetivo = consultas.usuarioPorId.get(Number(id));
  if (!objetivo) {
    return res.redirect('/panel?error=' + encodeURIComponent('No existe ese usuario'));
  }
  // Un admin no puede cambiarse el estado a sí mismo por error
  if (objetivo.id === req.usuario.id) {
    return res.redirect('/panel?error=' +
      encodeURIComponent('No puedes cambiar tu propio estado'));
  }

  consultas.cambiarEstadoUsuario.run('aprobado', Number(id));
  res.redirect('/panel?accion=aprobado');
});

router.post('/rechazar', (req, res) => {
  if (!soloAdmin(req, res)) return;
  const { id } = req.body;

  const objetivo = consultas.usuarioPorId.get(Number(id));
  if (!objetivo) {
    return res.redirect('/panel?error=' + encodeURIComponent('No existe ese usuario'));
  }
  // Nunca permitimos bloquearnos a nosotros mismos
  if (objetivo.id === req.usuario.id) {
    return res.redirect('/panel?error=' +
      encodeURIComponent('No puedes cambiar tu propio estado'));
  }

  consultas.cambiarEstadoUsuario.run('rechazado', Number(id));
  res.redirect('/panel?accion=rechazado');
});

module.exports = router;
