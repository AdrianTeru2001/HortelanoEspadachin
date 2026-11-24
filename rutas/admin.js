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
    // Borramos el vídeo que acabamos de guardar si falló la BD
    try { fs.unlinkSync(path.join(CARPETA_VIDEOS, archivoVideo.filename)); } catch (_) {}
    if (err.message && err.message.includes('UNIQUE')) {
      return error('Ya existe un capítulo con esa temporada y episodio.');
    }
    console.error(err);
    return error('No se pudo guardar el capítulo.');
  }
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
      try { fs.unlinkSync(path.join(carpeta, path.basename(archivo))); } catch (_) {}
    }
    return res.redirect('/panel?exito=capitulo-borrado');
  } catch (err) {
    console.error(err);
    return res.redirect('/panel?error=' + encodeURIComponent('No se pudo borrar'));
  }
});

module.exports = router;
