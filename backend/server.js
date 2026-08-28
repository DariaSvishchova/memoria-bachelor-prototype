import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 3000);
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:4200';
const JWT_SECRET = process.env.JWT_SECRET || 'memoria-development-secret-change-me';
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';
const DB_FILE = path.join(__dirname, 'data', 'db.json');
const UPLOAD_ROOT = path.join(__dirname, 'uploads');

for (const folder of ['data', 'uploads/photos', 'uploads/videos', 'uploads/audio']) {
  fs.mkdirSync(path.join(__dirname, folder), { recursive: true });
}
if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify({ users: [], memories: [], settings: [] }, null, 2));
}

const readDb = () => JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
const writeDb = (db) => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
const publicUrl = (relativePath) => relativePath ? `http://localhost:${PORT}/uploads/${relativePath.replaceAll('\\', '/')}` : undefined;
const safeUnlink = (relativePath) => {
  if (!relativePath) return;
  const absolute = path.resolve(UPLOAD_ROOT, relativePath);
  if (!absolute.startsWith(path.resolve(UPLOAD_ROOT))) return;
  if (fs.existsSync(absolute)) fs.unlinkSync(absolute);
};

const app = express();
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: FRONTEND_ORIGIN, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use('/uploads', express.static(UPLOAD_ROOT));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });
const cookieOptions = { httpOnly: true, sameSite: 'lax', secure: COOKIE_SECURE, maxAge: 7 * 24 * 60 * 60 * 1000, path: '/' };
const createToken = (user) => jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
const setAuthCookie = (res, user) => res.cookie('memoria_token', createToken(user), cookieOptions);

const requireAuth = (req, res, next) => {
  try {
    const token = req.cookies.memoria_token;
    if (!token) return res.status(401).json({ message: 'Bitte melde dich zuerst an.' });
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.sub;
    next();
  } catch {
    res.clearCookie('memoria_token', { ...cookieOptions, maxAge: undefined });
    return res.status(401).json({ message: 'Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.' });
  }
};

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const type = file.fieldname === 'photos' ? 'photos' : file.fieldname === 'videos' ? 'videos' : 'audio';
    cb(null, path.join(UPLOAD_ROOT, type));
  },
  filename(req, file, cb) {
    const extension = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '');
    cb(null, `${Date.now()}-${crypto.randomUUID()}${extension}`);
  }
});
const allowed = {
  photos: new Set(['image/jpeg', 'image/png', 'image/webp']),
  videos: new Set(['video/mp4', 'video/webm', 'video/quicktime']),
  originalAudio: new Set(['audio/webm', 'audio/wav', 'audio/mpeg', 'audio/mp4', 'audio/x-wav']),
  soundscape: new Set(['audio/webm', 'audio/wav', 'audio/mpeg', 'audio/mp4', 'audio/x-wav'])
};
const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024, files: 9 },
  fileFilter(req, file, cb) {
    cb(null, Boolean(allowed[file.fieldname]?.has(file.mimetype)));
  }
}).fields([
  { name: 'photos', maxCount: 5 },
  { name: 'videos', maxCount: 2 },
  { name: 'originalAudio', maxCount: 1 },
  { name: 'soundscape', maxCount: 1 }
]);

const defaultSettings = (userId, profileName) => ({
  userId, profileName, remindersEnabled: true, defaultReminder: 'In einem Monat',
  autoplaySoundscape: false, compactTimeline: false, language: 'Deutsch'
});
const exposeUser = (user) => ({ id: user.id, name: user.name, email: user.email, createdAt: user.createdAt });
const exposeMemory = (memory) => ({
  ...memory,
  photos: (memory.photos || []).map(publicUrl),
  videoNames: memory.videoNames || [],
  videoUrls: (memory.videos || []).map(publicUrl),
  audioUrl: publicUrl(memory.originalAudio),
  soundscapeUrl: publicUrl(memory.soundscape)
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.post('/api/auth/register', authLimiter, async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (name.length < 2) return res.status(400).json({ message: 'Bitte gib deinen Namen ein.' });
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ message: 'Bitte gib eine gültige E-Mail-Adresse ein.' });
  if (password.length < 8) return res.status(400).json({ message: 'Das Passwort muss mindestens 8 Zeichen enthalten.' });
  const db = readDb();
  if (db.users.some((user) => user.email === email)) return res.status(409).json({ message: 'Für diese E-Mail-Adresse besteht bereits ein Konto.' });
  const user = { id: crypto.randomUUID(), name, email, passwordHash: await bcrypt.hash(password, 12), createdAt: new Date().toISOString() };
  db.users.push(user);
  db.settings.push(defaultSettings(user.id, name));
  writeDb(db);
  setAuthCookie(res, user);
  res.status(201).json({ user: exposeUser(user) });
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const db = readDb();
  const user = db.users.find((item) => item.email === email);
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) return res.status(401).json({ message: 'E-Mail-Adresse oder Passwort ist nicht korrekt.' });
  setAuthCookie(res, user);
  res.json({ user: exposeUser(user) });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('memoria_token', { httpOnly: true, sameSite: 'lax', secure: COOKIE_SECURE, path: '/' });
  res.json({ message: 'Erfolgreich abgemeldet.' });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  const db = readDb();
  const user = db.users.find((item) => item.id === req.userId);
  if (!user) return res.status(401).json({ message: 'Benutzerkonto nicht gefunden.' });
  res.json({ user: exposeUser(user) });
});

app.get('/api/memories', requireAuth, (req, res) => {
  const db = readDb();
  const memories = db.memories.filter((item) => item.userId === req.userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ memories: memories.map(exposeMemory) });
});

app.post('/api/memories', requireAuth, upload, (req, res) => {
  try {
    const files = req.files || {};
    const title = String(req.body.title || '').trim();
    const date = String(req.body.date || '').trim();
    const location = String(req.body.location || '').trim();
    const description = String(req.body.description || '').trim();
    if (!title || !date || !location || !description) return res.status(400).json({ message: 'Titel, Datum, Ort und persönlicher Moment sind erforderlich.' });
    const relative = (file, folder) => file ? path.join(folder, file.filename) : undefined;
    const memory = {
      id: crypto.randomUUID(), userId: req.userId, title, date, location,
      category: String(req.body.category || 'Andere'), emotion: String(req.body.emotion || 'Freude'),
      people: String(req.body.people || ''), description, reminder: String(req.body.reminder || 'Keine Erinnerung'),
      coordinates: req.body.latitude && req.body.longitude ? { latitude: Number(req.body.latitude), longitude: Number(req.body.longitude) } : undefined,
      photos: (files.photos || []).map((file) => relative(file, 'photos')),
      videos: (files.videos || []).map((file) => relative(file, 'videos')),
      videoNames: (files.videos || []).map((file) => file.originalname),
      originalAudio: relative(files.originalAudio?.[0], 'audio'),
      soundscape: relative(files.soundscape?.[0], 'audio'),
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
    const db = readDb();
    db.memories.push(memory);
    writeDb(db);
    res.status(201).json({ memory: exposeMemory(memory) });
  } catch (error) {
    res.status(500).json({ message: 'Die Erinnerung konnte nicht gespeichert werden.' });
  }
});

app.delete('/api/memories/:id', requireAuth, (req, res) => {
  const db = readDb();
  const index = db.memories.findIndex((item) => item.id === req.params.id && item.userId === req.userId);
  if (index < 0) return res.status(404).json({ message: 'Erinnerung nicht gefunden.' });
  const [memory] = db.memories.splice(index, 1);
  [...(memory.photos || []), ...(memory.videos || []), memory.originalAudio, memory.soundscape].forEach(safeUnlink);
  writeDb(db);
  res.json({ message: 'Erinnerung gelöscht.' });
});

app.get('/api/settings', requireAuth, (req, res) => {
  const db = readDb();
  const user = db.users.find((item) => item.id === req.userId);
  let settings = db.settings.find((item) => item.userId === req.userId);
  if (!settings) {
    settings = defaultSettings(req.userId, user?.name || 'Memoria');
    db.settings.push(settings); writeDb(db);
  }
  res.json({ settings });
});

app.put('/api/settings', requireAuth, (req, res) => {
  const db = readDb();
  const index = db.settings.findIndex((item) => item.userId === req.userId);
  const current = index >= 0 ? db.settings[index] : defaultSettings(req.userId, 'Memoria');
  const settings = {
    ...current,
    profileName: String(req.body.profileName || current.profileName).trim().slice(0, 40),
    remindersEnabled: Boolean(req.body.remindersEnabled),
    defaultReminder: String(req.body.defaultReminder || current.defaultReminder),
    autoplaySoundscape: Boolean(req.body.autoplaySoundscape),
    compactTimeline: Boolean(req.body.compactTimeline),
    language: String(req.body.language || current.language)
  };
  if (index >= 0) db.settings[index] = settings; else db.settings.push(settings);
  const user = db.users.find((item) => item.id === req.userId);
  if (user && settings.profileName) user.name = settings.profileName;
  writeDb(db);
  res.json({ settings, user: user ? exposeUser(user) : undefined });
});

app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ message: 'Die ausgewählten Dateien sind zu groß oder überschreiten das erlaubte Limit.' });
  console.error(error);
  res.status(500).json({ message: 'Ein unerwarteter Serverfehler ist aufgetreten.' });
});

app.listen(PORT, () => console.log(`Memoria backend läuft auf http://localhost:${PORT}`));
