// ============================================================
// rutas/videos.js — Sirve los archivos de vídeo (MP4)
// ------------------------------------------------------------
// ESTA ES LA RUTA MÁS IMPORTANTE DE LA SEGURIDAD.
//
// Un vídeo en streaming no se manda entero de golpe: el
// navegador pide "dame los bytes del minuto 2 al 4" (para
// poder hacer seek). Eso se llama "Range Request".
//
// Por eso aquí:
//   1. COMPROBAMOS que el usuario esté logueado y APROBADO
//      (si no, 403 → nadie puede colgar el enlace y verlo)
//   2. Soportamos peticiones por rangos para que el
//      reproductor pueda adelantar/retroceder
// ============================================================

const express = require('express');
const fs = require('fs');
const path = require('path');

const { consultas } = require('../base-datos');

const router = express.Router();

// Carpeta donde guardamos los MP4 (fuera de /public, para que
// NO se sirvan solos: solo por esta ruta protegida)
const CARPETA_VIDEOS = path.join(__dirname, '..', 'videos');

// ------------------------------------------------------------
// GET /videos/:id
// ------------------------------------------------------------
router.get('/:id', (req, res) => {
  // --- 1. ¿Está logueado? ---
  if (!req.usuario) {
    return res.status(403).send('Inicia sesión para ver los vídeos.');
  }

  // --- 2. ¿Está aprobado? (por si acaso) ---
  if (req.usuario.estado !== 'aprobado') {
    return res.status(403).send('Tu cuenta está pendiente de aprobación.');
  }

  // --- 3. Buscamos el capítulo en la base de datos ---
  const capitulo = consultas.capituloPorId.get(Number(req.params.id));
  if (!capitulo) {
    return res.status(404).send('Capítulo no encontrado.');
  }

  // --- 4. Montamos la ruta real del archivo ---
  const rutaCompleta = path.join(CARPETA_VIDEOS, path.basename(capitulo.ruta_video));

  // ¿Existe el archivo en disco?
  if (!fs.existsSync(rutaCompleta)) {
    return res.status(404).send('El archivo de vídeo no está en el servidor.');
  }

  const estadisticas = fs.statSync(rutaCompleta);
  const tamanoTotal = estadisticas.size;

  // Cabecera común: le decimos al navegador que es un MP4
  res.set('Content-Type', 'video/mp4');
  // Evita que Cloudflare o el navegador guarden una copia en caché compartida
  res.set('Cache-Control', 'private, no-store');

  // --- 5. ¿Pidió un rango concreto? (adelantar/retroceder) ---
  const cabeceraRango = req.headers.range;

  if (cabeceraRango) {
    // Ejemplo de cabecera: "bytes=1000-2000" → quiero de la
    // posición 1000 a la 2000 del archivo
    const partes = cabeceraRango.replace(/bytes=/, '').split('-');
    let inicio = parseInt(partes[0], 10);
    let fin = partes[1] ? parseInt(partes[1], 10) : tamanoTotal - 1;

    // Límites de seguridad
    if (isNaN(inicio)) inicio = 0;
    if (isNaN(fin) || fin >= tamanoTotal) fin = tamanoTotal - 1;

    if (inicio > fin) {
      return res.status(416).set('Content-Range', `bytes */${tamanoTotal}`).end();
    }

    const tamanoTrozo = fin - inicio + 1;

    res.status(206); // 206 = "contenido parcial"
    res.set('Content-Range', `bytes ${inicio}-${fin}/${tamanoTotal}`);
    res.set('Accept-Ranges', 'bytes');
    res.set('Content-Length', String(tamanoTrozo));

    // Abrimos un "stream" (un flujo) y lanzamos solo ese trozo
    const flujo = fs.createReadStream(rutaCompleta, { start: inicio, end: fin });
    flujo.pipe(res);

    flujo.on('error', () => res.destroy());
  } else {
    // --- 6. Sin rango: mandamos el archivo entero ---
    res.set('Content-Length', String(tamanoTotal));
    res.set('Accept-Ranges', 'bytes');

    const flujo = fs.createReadStream(rutaCompleta);
    flujo.pipe(res);

    flujo.on('error', () => res.destroy());
  }
});

module.exports = router;
