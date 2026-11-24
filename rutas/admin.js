// ============================================================
// rutas/admin.js — El panel de administración (solo para ti)
// ------------------------------------------------------------
// Aquí puedes:
//   - Ver y aprobar/rechazar usuarios pendientes
//   - Subir capítulos (vídeo + miniatura + datos)
//   - Editar o borrar capítulos existentes
//
// TODAS estas rutas comprueban que quien pide sea admin.
// ============================================================

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');

const { consultas } = require('../base-datos');

const router = express.Router();

const CARPETA_VIDEOS = path.join(__dirname, '..', 'videos');
const CARPETA_MINIATURAS = path.join(__dirname, '..', 'miniaturas');

// Creamos las carpetas si no existen (fs.mkdirSync con recursive
// no da error aunque ya exista)
fs.mkdirSync(CARPETA_VIDEOS, { recursive: true });
fs.mkdirSync(CARPETA_MINIATURAS, { recursive: true });

// ------------------------------------------------------------
// MIDDLEWARE: solo el administrador pasa
// ------------------------------------------------------------
router.use((req, res, next) => {
  if (!req.usuario || !req.usuario.es_admin) {
    return res.status(403).send('Acceso reservado al administrador.');
  }
  next();
});

// ------------------------------------------------------------
// CONFIGURACIÓN DE SUBIDA DE ARCHIVOS (multer)
// ------------------------------------------------------------
// "multer" se encarga de recibir archivos que llegan en un
// formulario HTML con <input type="file">.
//
// storage: dónde guardamos y con qué nombre
// limits:  límite de tamaño (2 GB para el vídeo)
// ------------------------------------------------------------
const almacenamiento = multer.diskStorage({
  destination(req, file, cb) {
    // Los vídeos van a /videos, el resto (miniaturas) a /miniaturas
    const esVideo = file.fieldname === 'video';
    cb(null, esVideo ? CARPETA_VIDEOS : CARPETA_MINIATURAS);
  },
  filename(req, file, cb) {
    // Nombre único con UUID + extensión original, para que no
    // haya colisiones ni problemas con tildes/espacios
    const extension = path.extname(file.originalname).toLowerCase();
    cb(null, randomUUID() + extension);
  },
});

const subida = multer({
  storage: almacenamiento,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2 GB
});

function borrarArchivo(carpeta, nombre) {
  if (!nombre) return;

  const ruta = path.join(carpeta, path.basename(nombre));
  try {
    fs.unlinkSync(ruta);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(`No se pudo borrar el archivo "${ruta}":`, err);
    }
  }
}

function borrarArchivosSubidos(files) {
  for (const campo of Object.values(files || {})) {
    for (const archivo of campo) {
      const carpeta = archivo.fieldname === 'video' ? CARPETA_VIDEOS : CARPETA_MINIATURAS;
      borrarArchivo(carpeta, archivo.filename);
    }
  }
}

// ------------------------------------------------------------
// GET /admin → la propia página del panel
// (la lógica de pintarla está en rutas/paginas.js, pero
//  montamos también una redirección por si acaso)
// ------------------------------------------------------------
router.get('/', (req, res) => {
  res.redirect('/panel');
});
// ------------------------------------------------------------
// POST /admin/subir → sube un capítulo nuevo
// ------------------------------------------------------------
// Los nombres de campo deben coincidir con el formulario:
//   titulo, temporada, episodio, sinopsis, duracion, video, miniatura
// ------------------------------------------------------------
router.post('/subir', subida.fields([
  { name: 'video', maxCount: 1 },
  { name: 'miniatura', maxCount: 1 },
]), (req, res) => {
  const { titulo, temporada, episodio, sinopsis, duracion } = req.body;

  const error = (msg) =>
    res.redirect('/panel?error=' + encodeURIComponent(msg));

  if (!titulo || !temporada || !episodio) {
    return error('Título, temporada y episodio son obligatorios.');
  }

  const archivoVideo = req.files && req.files.video && req.files.video[0];
  if (!archivoVideo) {
    return error('Tienes que elegir un archivo de vídeo MP4.');
  }

  // Si no subió miniatura, usamos un placeholder (verde, estilo serie)
  let rutaMiniatura = '';
  const archivoMiniatura = req.files && req.files.miniatura && req.files.miniatura[0];
  if (archivoMiniatura) {
    rutaMiniatura = archivoMiniatura.filename;
  }

  try {
    consultas.crearCapitulo.run({
      titulo,
      temporada: Number(temporada),
      episodio: Number(episodio),
      sinopsis: sinopsis || '',
      duracion: duracion || '',
      ruta_video: archivoVideo.filename,
      ruta_miniatura: rutaMiniatura,
    });
    return res.redirect('/panel?exito=capitulo-subido');
  } catch (err) {
    borrarArchivosSubidos(req.files);
    if (err.message && err.message.includes('UNIQUE')) {
      return error('Ya existe un capítulo con esa temporada y episodio.');
    }
    console.error(err);
    return error('No se pudo guardar el capítulo.');
  }
});

// ------------------------------------------------------------
// POST /admin/editar/:id → actualiza los datos y archivos de un capítulo
// ------------------------------------------------------------
router.post('/editar/:id', (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return res.redirect('/panel?error=' + encodeURIComponent('El capítulo indicado no es válido.'));
  }
  if (!consultas.capituloPorId.get(id)) {
    return res.redirect('/panel?error=' + encodeURIComponent('No existe ese capítulo.'));
  }
  next();
}, subida.fields([
  { name: 'video', maxCount: 1 },
  { name: 'miniatura', maxCount: 1 },
]), (req, res) => {
  const id = Number(req.params.id);
  const capitulo = consultas.capituloPorId.get(id);
  if (!capitulo) {
    borrarArchivosSubidos(req.files);
    return res.redirect('/panel?error=' + encodeURIComponent('No existe ese capítulo.'));
  }

  const { titulo, temporada, episodio, sinopsis, duracion } = req.body;
  const temporadaNumero = Number(temporada);
  const episodioNumero = Number(episodio);
  const archivoVideo = req.files && req.files.video && req.files.video[0];
  const archivoMiniatura = req.files && req.files.miniatura && req.files.miniatura[0];

  const error = (mensaje) => {
    borrarArchivosSubidos(req.files);
    return res.redirect('/panel?error=' + encodeURIComponent(mensaje));
  };

  if (typeof titulo !== 'string' || !titulo.trim()) {
    return error('El título es obligatorio.');
  }
  if (typeof temporada !== 'string' || !/^\d+$/.test(temporada) ||
      !Number.isSafeInteger(temporadaNumero) || temporadaNumero < 1) {
    return error('La temporada debe ser un número entero mayor que cero.');
  }
  if (typeof episodio !== 'string' || !/^\d+$/.test(episodio) ||
      !Number.isSafeInteger(episodioNumero) || episodioNumero < 0) {
    return error('El episodio debe ser un número entero igual o mayor que cero.');
  }

  const borrarMiniatura = req.body.borrarMiniatura === '1' && !archivoMiniatura;
  const rutaVideo = archivoVideo ? archivoVideo.filename : capitulo.ruta_video;
  const rutaMiniatura = archivoMiniatura
    ? archivoMiniatura.filename
    : borrarMiniatura ? '' : capitulo.ruta_miniatura;

  try {
    consultas.actualizarCapitulo.run({
      id,
      titulo: titulo.trim(),
      temporada: temporadaNumero,
      episodio: episodioNumero,
      sinopsis: typeof sinopsis === 'string' ? sinopsis : '',
      duracion: typeof duracion === 'string' ? duracion.trim() : '',
      ruta_video: rutaVideo,
      ruta_miniatura: rutaMiniatura,
    });
  } catch (err) {
    borrarArchivosSubidos(req.files);
    if (err.message && err.message.includes('UNIQUE')) {
      return res.redirect('/panel?error=' +
        encodeURIComponent('Ya existe un capítulo con esa temporada y episodio.'));
    }
    console.error('No se pudo actualizar el capítulo:', err);
    return res.redirect('/panel?error=' + encodeURIComponent('No se pudo actualizar el capítulo.'));
  }

  if (archivoVideo) borrarArchivo(CARPETA_VIDEOS, capitulo.ruta_video);
  if (archivoMiniatura || borrarMiniatura) {
    borrarArchivo(CARPETA_MINIATURAS, capitulo.ruta_miniatura);
  }

  return res.redirect('/panel?exito=capitulo-actualizado');
});

// ------------------------------------------------------------
// POST /admin/borrar → borra un capítulo (y sus archivos)
// ------------------------------------------------------------
router.post('/borrar', (req, res) => {
  const { id } = req.body;
  const capitulo = consultas.capituloPorId.get(Number(id));
  if (!capitulo) {
    return res.redirect('/panel?error=' + encodeURIComponent('No existe ese capítulo'));
  }

  try {
    consultas.borrarCapitulo.run(Number(id));
    // Borramos también los archivos pesados del disco
    for (const archivo of [capitulo.ruta_video, capitulo.ruta_miniatura]) {
      if (!archivo) continue;
      const carpeta = archivo === capitulo.ruta_video ? CARPETA_VIDEOS : CARPETA_MINIATURAS;
      borrarArchivo(carpeta, archivo);
    }
    return res.redirect('/panel?exito=capitulo-borrado');
  } catch (err) {
    console.error(err);
    return res.redirect('/panel?error=' + encodeURIComponent('No se pudo borrar'));
  }
});

module.exports = router;
