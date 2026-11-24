// ============================================================
// base-datos.js
// ------------------------------------------------------------
// Aquí está todo el "cerebro de datos" del proyecto.
//
// Usamos SQLite, que es una base de datos que vive en UN SOLO
// archivo (datos.db). No hay que instalar un servidor de base
// de datos: simplemente guardamos y leemos de ese archivo.
//
// Las dos tablas que tenemos:
//
//   usuarios  → quién se registró, su contraseña, y si está
//               aprobado o pendiente
//   capitulos → título, temporada, episodio, sinopsis, y las
//               rutas de los archivos de vídeo y miniatura
// ============================================================

const Database = require('better-sqlite3');
const path = require('path');

// La base de datos se guardará en la carpeta del proyecto
const RUTA_DB = path.join(__dirname, 'datos.db');

const db = new Database(RUTA_DB);

// SQLite es más rápido y estable si activamos los "WAL"
db.pragma('journal_mode = WAL');
// Las claves foráneas nos garantizan coherencia entre tablas
db.pragma('foreign_keys = ON');

// ------------------------------------------------------------
// Creamos las tablas si no existen todavía.
// "CREATE TABLE IF NOT EXISTS" = créala solo si ya no está.
// ------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS usuarios (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre          TEXT NOT NULL UNIQUE,      -- nombre de usuario (para entrar)
    email           TEXT NOT NULL UNIQUE,      -- correo electrónico
    contrasena_hash TEXT NOT NULL,             -- contraseña CIFRADA (nunca el texto original)
    es_admin        INTEGER NOT NULL DEFAULT 0,-- 1 = eres tú (el dueño)
    estado          TEXT NOT NULL DEFAULT 'pendiente',
                    -- 'pendiente'  → registrado, esperando tu aprobación
                    -- 'aprobado'   → ya puede ver la web
                    -- 'rechazado'  → le dijiste que no
    fecha_registro  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS capitulos (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    titulo       TEXT NOT NULL,                -- "El capítulo piloto"
    temporada    INTEGER NOT NULL DEFAULT 1,    -- nº de temporada
    episodio     INTEGER NOT NULL,             -- nº de episodio dentro de la temporada
    sinopsis     TEXT NOT NULL DEFAULT '',     -- descripción breve
    duracion     TEXT NOT NULL DEFAULT '',     -- "12:34" (para mostrar)
    ruta_video   TEXT NOT NULL,                -- dónde está el MP4
    ruta_miniatura TEXT NOT NULL DEFAULT '',   -- dónde está la imagen de portada
    fecha_subida TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(temporada, episodio)                -- no puede haber dos "T1E1"
  );
`);

// ------------------------------------------------------------
// Preparamos las consultas que repetiremos muchas veces.
// "prepare" compila la consulta una vez y la reutilizamos
// (mucho más rápido que escribirla entera cada vez).
// ------------------------------------------------------------
const consultas = {
  // --- Usuarios ---
  crearUsuario: db.prepare(`
    INSERT INTO usuarios (nombre, email, contrasena_hash, es_admin, estado)
    VALUES (@nombre, @email, @contrasena_hash, @es_admin, @estado)
  `),

  usuarioPorNombre: db.prepare(`
    SELECT * FROM usuarios WHERE nombre = ?
  `),

  usuarioPorId: db.prepare(`
    SELECT id, nombre, email, es_admin, estado, fecha_registro
    FROM usuarios WHERE id = ?
  `),

  todosLosUsuarios: db.prepare(`
    SELECT id, nombre, email, es_admin, estado, fecha_registro
    FROM usuarios ORDER BY fecha_registro DESC
  `),

  usuariosPendientes: db.prepare(`
    SELECT id, nombre, email, fecha_registro
    FROM usuarios WHERE estado = 'pendiente'
    ORDER BY fecha_registro ASC
  `),

  cambiarEstadoUsuario: db.prepare(`
    UPDATE usuarios SET estado = ? WHERE id = ?
  `),

  // --- Capítulos ---
  todosLosCapitulos: db.prepare(`
    SELECT * FROM capitulos
    ORDER BY temporada ASC, episodio ASC
  `),

  capituloPorId: db.prepare(`
    SELECT * FROM capitulos WHERE id = ?
  `),

  ultimoCapitulo: db.prepare(`
    SELECT * FROM capitulos
    ORDER BY fecha_subida DESC
    LIMIT 1
  `),

  // El siguiente episodio (para el botón "siguiente")
  siguienteCapitulo: db.prepare(`
    SELECT * FROM capitulos
    WHERE (temporada > @temporada)
       OR (temporada = @temporada AND episodio > @episodio)
    ORDER BY temporada ASC, episodio ASC
    LIMIT 1
  `),

  contarCapitulos: db.prepare(`
    SELECT COUNT(*) AS total FROM capitulos
  `),

  crearCapitulo: db.prepare(`
    INSERT INTO capitulos
      (titulo, temporada, episodio, sinopsis, duracion, ruta_video, ruta_miniatura)
    VALUES
      (@titulo, @temporada, @episodio, @sinopsis, @duracion, @ruta_video, @ruta_miniatura)
  `),

  actualizarCapitulo: db.prepare(`
    UPDATE capitulos
    SET titulo = @titulo,
        temporada = @temporada,
        episodio = @episodio,
        sinopsis = @sinopsis,
        duracion = @duracion,
        ruta_video = @ruta_video,
        ruta_miniatura = @ruta_miniatura
    WHERE id = @id
  `),

  borrarCapitulo: db.prepare(`
    DELETE FROM capitulos WHERE id = ?
  `),
};

// ------------------------------------------------------------
// Función para crear el primer usuario: TÚ.
// Se ejecuta solo si todavía no hay ningún administrador.
// Así nadie más puede registrarse como admin.
// ------------------------------------------------------------
function contarAdmins() {
  const fila = db.prepare(
    `SELECT COUNT(*) AS total FROM usuarios WHERE es_admin = 1`
  ).get();
  return fila.total;
}

module.exports = { db, consultas, contarAdmins };
