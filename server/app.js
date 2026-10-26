const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit').rateLimit;
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { zipSync, strToU8 } = require('fflate');
const { buildSlots, toMinutes } = require('./lib/scheduling');
const { openDatabase } = require('./lib/db');

const COOKIE_NAME = 'dorak_token';
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const BOOKING_STATUSES = ['pending_payment', 'pending_review', 'confirmed', 'checked_in', 'completed', 'cancelled'];

function createApp(options = {}) {
  const isProduction = options.isProduction ?? process.env.NODE_ENV === 'production';
  const JWT_SECRET = options.jwtSecret || process.env.JWT_SECRET || 'local-demo-secret-change-before-deployment-2026';
  const ADMIN_USERNAME = options.adminUsername || process.env.ADMIN_USERNAME || 'admin';
  const ADMIN_PASSWORD = options.adminPassword || process.env.ADMIN_PASSWORD || 'Dorak@12345';
  const COOKIE_SECURE = String(options.cookieSecure ?? process.env.COOKIE_SECURE ?? (isProduction ? 'true' : 'false')) === 'true';
  const quiet = Boolean(options.quiet);
  const DATA_DIR = options.dataDir || path.join(__dirname, 'data');
  const UPLOAD_DIR = options.uploadDir || path.join(__dirname, 'uploads');
  const dbPath = options.dbPath || path.join(DATA_DIR, 'dorak.db');
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const log = (...args) => { if (!quiet) console.log(...args); };

  const db = openDatabase(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone TEXT NOT NULL,
  email TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer','admin')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS clinics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  specialty TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  floor TEXT NOT NULL DEFAULT '',
  room TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS doctors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic_id INTEGER NOT NULL REFERENCES clinics(id),
  name TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  years_experience INTEGER NOT NULL DEFAULT 0,
  opening_time TEXT,
  closing_time TEXT,
  slot_interval INTEGER,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS doctor_days_off (
  doctor_id INTEGER NOT NULL REFERENCES doctors(id),
  date TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (doctor_id, date)
);
CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL DEFAULT 0 CHECK (price >= 0),
  duration_minutes INTEGER NOT NULL DEFAULT 30 CHECK (duration_minutes > 0 AND duration_minutes <= 480),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  business_name TEXT NOT NULL DEFAULT 'دورك',
  business_description TEXT NOT NULL DEFAULT 'احجز موعدك بسهولة، واعرف وقتك قبل ما توصل.',
  business_phone TEXT NOT NULL DEFAULT '',
  opening_time TEXT NOT NULL DEFAULT '12:00',
  closing_time TEXT NOT NULL DEFAULT '00:00',
  slot_interval INTEGER NOT NULL DEFAULT 30,
  deposit_required INTEGER NOT NULL DEFAULT 0 CHECK (deposit_required IN (0,1)),
  deposit_amount INTEGER NOT NULL DEFAULT 50 CHECK (deposit_amount >= 0),
  payment_instructions TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS blocked_dates (
  date TEXT PRIMARY KEY,
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  service_id INTEGER NOT NULL REFERENCES services(id),
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  booking_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  price_snapshot INTEGER NOT NULL,
  deposit_amount INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('pending_payment','pending_review','confirmed','checked_in','completed','cancelled')),
  payment_status TEXT NOT NULL DEFAULT 'not_required' CHECK (payment_status IN ('not_required','pending','pending_review','approved','rejected')),
  receipt_filename TEXT,
  customer_note TEXT NOT NULL DEFAULT '',
  admin_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bookings_date_status ON bookings(booking_date, status);
CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id, created_at);
CREATE TABLE IF NOT EXISTS booking_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES bookings(id),
  actor_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

  // Upgrade databases created by the single-place MVP.
  const columnsOf = (table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  const addColumn = (table, name, ddl) => { if (!columnsOf(table).includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`); };
  addColumn('settings', 'business_address', "TEXT NOT NULL DEFAULT ''");
  addColumn('settings', 'cancellation_policy', "TEXT NOT NULL DEFAULT 'العربون غير مسترد في حالة إلغاء الحجز.'");
  addColumn('services', 'clinic_id', 'INTEGER REFERENCES clinics(id)');
  addColumn('bookings', 'clinic_id', 'INTEGER REFERENCES clinics(id)');
  addColumn('bookings', 'doctor_id', 'INTEGER REFERENCES doctors(id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_bookings_doctor_date ON bookings(doctor_id, booking_date)');

  // One administrator for the whole building.
  const existingAdmin = db.prepare("SELECT id, username FROM users WHERE role = 'admin' LIMIT 1").get();
  if (!existingAdmin) {
    if (db.prepare('SELECT id FROM users WHERE username = ?').get(ADMIN_USERNAME)) throw new Error(`ADMIN_USERNAME "${ADMIN_USERNAME}" already belongs to a customer. Choose another admin username in .env.`);
    db.prepare(`INSERT INTO users (name, username, phone, password_hash, role) VALUES (?, ?, ?, ?, 'admin')`)
      .run('مسؤول المبنى', ADMIN_USERNAME, '0000000000', bcrypt.hashSync(ADMIN_PASSWORD, options.bcryptRounds ?? 12));
    log(`✅ Admin created: username="${ADMIN_USERNAME}"`);
  } else {
    log(`✅ Admin account ready: username="${existingAdmin.username}"`);
  }
  if (!db.prepare('SELECT id FROM settings WHERE id = 1').get()) {
    db.prepare(`INSERT INTO settings (id, business_name, business_description, business_address, opening_time, closing_time, slot_interval, deposit_required, deposit_amount, payment_instructions)
      VALUES (1, 'مجمع دورك الطبي', 'مبنى واحد وعيادات متخصصة في كل دور. اختار التخصص والدكتور واحجز موعدك من غير انتظار.', 'دمياط، مصر', '12:00', '00:00', 30, 0, 50, '')`).run();
  }
  if (options.seed !== false && db.prepare('SELECT COUNT(*) AS n FROM clinics').get().n === 0) seedDemoBuilding();

  function seedDemoBuilding() {
    // Demo content so the site is not empty on first run. Edit or deactivate everything from the admin panel.
    db.prepare('UPDATE services SET is_active = 0 WHERE clinic_id IS NULL').run();
    const addClinic = db.prepare('INSERT INTO clinics (name, specialty, description, floor, room, sort_order) VALUES (?, ?, ?, ?, ?, ?)');
    const addDoctor = db.prepare('INSERT INTO doctors (clinic_id, name, title, bio, years_experience) VALUES (?, ?, ?, ?, ?)');
    const addService = db.prepare('INSERT INTO services (clinic_id, name, description, price, duration_minutes) VALUES (?, ?, ?, ?, ?)');
    const clinics = [
      ['العيادة العامة', 'باطنة وطب أسرة', 'كشف عام ومتابعة الحالات المزمنة وتحاليل الفحص الدوري.', 'الدور الأرضي', '01',
        [['د. أحمد محمد', 'استشاري الباطنة', 'متابعة الضغط والسكر وأمراض الجهاز الهضمي.', 14]],
        [['كشف عام', 'فحص وتشخيص', 200, 30], ['متابعة', 'زيارة متابعة قصيرة', 100, 15]]],
      ['عيادة الأطفال', 'طب الأطفال وحديثي الولادة', 'متابعة النمو والتطعيمات وعلاج أمراض الطفولة.', 'الدور الأول', '12',
        [['د. وليد حسن', 'أخصائي طب الأطفال', 'متابعة النمو والتغذية والتطعيمات.', 9], ['د. منى عادل', 'استشاري الأطفال', 'حديثي الولادة وأمراض الصدر عند الأطفال.', 17]],
        [['كشف أطفال', 'فحص وتشخيص', 180, 30], ['استشارة تغذية', 'خطة تغذية حسب السن', 250, 30]]],
      ['عيادة الجلدية', 'الجلدية والتجميل', 'علاج الأمراض الجلدية والشعر وجلسات العناية بالبشرة.', 'الدور الثاني', '204',
        [['د. سارة علي', 'استشاري الجلدية', 'حب الشباب والأكزيما وأمراض الشعر.', 11]],
        [['كشف جلدية', 'فحص وخطة علاج', 250, 30], ['جلسة بشرة', 'تنظيف وعناية', 400, 45]]],
      ['عيادة الأسنان', 'طب وجراحة الأسنان', 'حشو وتنظيف وتقويم وزراعة بأحدث الأجهزة.', 'الدور الثاني', '210',
        [['د. كريم فتحي', 'أخصائي تقويم الأسنان', 'التقويم وتجميل الأسنان.', 8], ['د. هالة صبري', 'استشاري جراحة الفم', 'الزراعة وجراحات الفم.', 15]],
        [['كشف أسنان', 'فحص وتصوير', 150, 30], ['تنظيف جير', 'تنظيف كامل', 300, 45], ['حشو عصب', 'جلسة علاج', 600, 60]]],
      ['عيادة العيون', 'طب وجراحة العيون', 'قياس النظر وفحص القرنية وعلاج جفاف العين.', 'الدور الثالث', '305',
        [['د. ياسر مصطفى', 'استشاري طب العيون', 'قياس النظر والمياه البيضاء.', 18]],
        [['كشف عيون', 'فحص وقياس نظر', 220, 30]]],
      ['عيادة العظام', 'العظام والمفاصل', 'علاج إصابات الملاعب وآلام الظهر والمفاصل.', 'الدور الثالث', '310',
        [['د. طارق سعيد', 'استشاري العظام', 'إصابات الملاعب وجراحة المناظير.', 16]],
        [['كشف عظام', 'فحص وتشخيص', 250, 30], ['متابعة بعد جراحة', 'زيارة متابعة', 150, 20]]],
    ];
    db.transaction(() => {
      clinics.forEach(([name, specialty, description, floor, room, doctors, services], index) => {
        const clinicId = Number(addClinic.run(name, specialty, description, floor, room, index).lastInsertRowid);
        doctors.forEach(([dn, title, bio, years]) => addDoctor.run(clinicId, dn, title, bio, years));
        services.forEach(([sn, sd, price, minutes]) => addService.run(clinicId, sn, sd, price, minutes));
      });
    })();
  }

  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));

  const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: options.authLimit ?? 35, standardHeaders: true, legacyHeaders: false, message: { error: 'محاولات كثيرة. حاول مرة أخرى بعد قليل.' } });
  app.use('/api/auth/login', authLimiter);
  app.use('/api/auth/register', authLimiter);

  function parseToken(req) {
    const match = (req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
    return match ? decodeURIComponent(match[1]) : null;
  }
  function requireAuth(req, res, next) {
    const token = parseToken(req);
    if (!token) return res.status(401).json({ error: 'سجّل الدخول أولًا.' });
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      const user = db.prepare('SELECT id, name, username, phone, email, role FROM users WHERE id = ?').get(payload.sub);
      if (!user) return res.status(401).json({ error: 'الجلسة غير صالحة. سجّل الدخول مرة أخرى.' });
      req.user = user;
      next();
    } catch {
      return res.status(401).json({ error: 'انتهت الجلسة. سجّل الدخول مرة أخرى.' });
    }
  }
  function requireAdmin(req, res, next) {
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'هذه الصفحة للمسؤول فقط.' });
    next();
  }
  const adminOnly = [requireAuth, requireAdmin];
  function setAuthCookie(res, user) {
    const token = jwt.sign({ sub: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie(COOKIE_NAME, token, { httpOnly: true, secure: COOKIE_SECURE, sameSite: 'lax', maxAge: COOKIE_MAX_AGE, path: '/' });
  }
  const cleanUser = (u) => ({ id: u.id, name: u.name, username: u.username, phone: u.phone, email: u.email || '', role: u.role });

  function isValidDate(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return false;
    const parsed = new Date(`${date}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
  }
  const cairoParts = (now = new Date()) => {
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
    return { date, minutes: toMinutes(time) };
  };
  const todayLocal = () => cairoParts().date;
  const bad = (message, status = 400) => Object.assign(new Error(message), { status });
  const handle = (fn) => (req, res, next) => { try { fn(req, res, next); } catch (error) { if (error.status) return res.status(error.status).json({ error: error.message }); next(error); } };

  const settingsRow = () => db.prepare('SELECT * FROM settings WHERE id = 1').get();
  const closureFor = (date, doctorId) => {
    const building = db.prepare('SELECT reason FROM blocked_dates WHERE date = ?').get(date);
    if (building) return building.reason || 'المبنى مغلق في هذا اليوم';
    const off = db.prepare('SELECT reason FROM doctor_days_off WHERE doctor_id = ? AND date = ?').get(doctorId, date);
    if (off) return off.reason ? `الدكتور في إجازة: ${off.reason}` : 'الدكتور في إجازة في هذا اليوم';
    return '';
  };

  function listSlots({ date, doctorId, serviceId, excludeBookingId = null, allowPast = false }) {
    if (!isValidDate(date)) throw bad('اختر تاريخًا صحيحًا.');
    const doctor = db.prepare('SELECT * FROM doctors WHERE id = ?').get(Number(doctorId));
    if (!doctor) throw bad('الدكتور غير موجود.');
    const service = db.prepare('SELECT id, duration_minutes FROM services WHERE id = ?').get(Number(serviceId));
    if (!service) throw bad('الخدمة غير موجودة.');
    const settings = settingsRow();
    const reason = closureFor(date, doctor.id);
    const booked = db.prepare(`SELECT id, start_time, duration_minutes FROM bookings WHERE doctor_id = ? AND booking_date = ? AND status != 'cancelled'`)
      .all(doctor.id, date).filter((b) => Number(b.id) !== Number(excludeBookingId));
    const now = cairoParts();
    let pastCutoff = null;
    if (!allowPast) { if (date < now.date) pastCutoff = Infinity; else if (date === now.date) pastCutoff = now.minutes; }
    const slots = buildSlots({
      opening: doctor.opening_time || settings.opening_time,
      closing: doctor.closing_time || settings.closing_time,
      interval: doctor.slot_interval || settings.slot_interval,
      duration: service.duration_minutes, booked, blocked: Boolean(reason), pastCutoff,
    });
    return { slots, blocked: Boolean(reason), reason };
  }

  const makeCode = () => `DRK-${todayLocal().replaceAll('-', '').slice(2)}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const addEvent = (bookingId, actorId, action, note = '') => db.prepare('INSERT INTO booking_events (booking_id, actor_id, action, note) VALUES (?, ?, ?, ?)').run(bookingId, actorId || null, action, note);
  const safeUnlink = (filename) => { if (!filename) return; try { fs.unlinkSync(path.join(UPLOAD_DIR, path.basename(filename))); } catch { /* no-op */ } };

  function bookingView(row) {
    return {
      id: row.id, code: row.code, userId: row.user_id, customerName: row.customer_name, customerPhone: row.customer_phone,
      serviceId: row.service_id, serviceName: row.service_name,
      clinicId: row.clinic_id, clinicName: row.clinic_name || '', clinicFloor: row.clinic_floor || '', clinicRoom: row.clinic_room || '',
      doctorId: row.doctor_id, doctorName: row.doctor_name || '', doctorTitle: row.doctor_title || '',
      bookingDate: row.booking_date, startTime: row.start_time, durationMinutes: row.duration_minutes,
      price: row.price_snapshot, depositAmount: row.deposit_amount, status: row.status, paymentStatus: row.payment_status,
      receiptAvailable: Boolean(row.receipt_filename), customerNote: row.customer_note, adminNote: row.admin_note,
      createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }
  const bookingSelect = `SELECT b.*, s.name AS service_name, c.name AS clinic_name, c.floor AS clinic_floor, c.room AS clinic_room, d.name AS doctor_name, d.title AS doctor_title
    FROM bookings b JOIN services s ON s.id = b.service_id LEFT JOIN clinics c ON c.id = b.clinic_id LEFT JOIN doctors d ON d.id = b.doctor_id`;

  // ---------- Authentication ----------
  app.post('/api/auth/register', handle((req, res) => {
    const { name, username, phone, email = '', password } = req.body || {};
    if (!name || String(name).trim().length < 2) throw bad('اكتب الاسم بشكل صحيح.');
    if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(String(username || ''))) throw bad('اسم المستخدم من 3 إلى 32 حرفًا/رقمًا، ويمكن استخدام . _ -.');
    if (!phone || String(phone).trim().length < 7) throw bad('اكتب رقم موبايل صحيحًا.');
    if (!password || String(password).length < 8) throw bad('كلمة المرور لازم تكون 8 أحرف على الأقل.');
    try {
      const hash = bcrypt.hashSync(String(password), options.bcryptRounds ?? 12);
      // The role is never read from the request: every self-registered account is a customer.
      const result = db.prepare(`INSERT INTO users (name, username, phone, email, password_hash, role) VALUES (?, ?, ?, ?, ?, 'customer')`)
        .run(String(name).trim(), String(username).trim(), String(phone).trim(), String(email).trim(), hash);
      const user = db.prepare('SELECT id, name, username, phone, email, role FROM users WHERE id = ?').get(result.lastInsertRowid);
      setAuthCookie(res, user);
      return res.status(201).json({ user: cleanUser(user) });
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) throw bad('اسم المستخدم مستخدم بالفعل، اختار اسمًا آخر.', 409);
      throw error;
    }
  }));
  app.post('/api/auth/login', handle((req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) throw bad('اكتب اسم المستخدم وكلمة المرور.');
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username).trim());
    if (!user || !bcrypt.compareSync(String(password), user.password_hash)) throw bad('اسم المستخدم أو كلمة المرور غير صحيحة.', 401);
    setAuthCookie(res, user);
    res.json({ user: cleanUser(user) });
  }));
  app.post('/api/auth/logout', (_req, res) => {
    res.clearCookie(COOKIE_NAME, { httpOnly: true, secure: COOKIE_SECURE, sameSite: 'lax', path: '/' });
    res.json({ ok: true });
  });
  app.get('/api/auth/me', requireAuth, (req, res) => res.json({ user: req.user }));

  // ---------- Public: building, clinics, doctors, services, slots ----------
  const publicSettings = () => {
    const s = settingsRow();
    return { business_name: s.business_name, business_description: s.business_description, business_phone: s.business_phone, business_address: s.business_address,
      opening_time: s.opening_time, closing_time: s.closing_time, slot_interval: s.slot_interval, deposit_required: Boolean(s.deposit_required), deposit_amount: s.deposit_amount, payment_instructions: s.payment_instructions, cancellation_policy: s.cancellation_policy };
  };
  const doctorPublic = (d) => ({ id: d.id, clinic_id: d.clinic_id, name: d.name, title: d.title, bio: d.bio, years_experience: d.years_experience, opening_time: d.opening_time, closing_time: d.closing_time });
  app.get('/api/public/settings', (_req, res) => res.json(publicSettings()));
  app.get('/api/public/building', (_req, res) => {
    const s = publicSettings();
    const clinics = db.prepare('SELECT id, name, specialty, description, floor, room FROM clinics WHERE is_active = 1 ORDER BY sort_order, id').all();
    const doctors = db.prepare('SELECT * FROM doctors WHERE is_active = 1 ORDER BY id').all();
    const services = db.prepare('SELECT id, clinic_id, name, description, price, duration_minutes FROM services WHERE is_active = 1 AND clinic_id IS NOT NULL ORDER BY id').all();
    res.json({
      building: { name: s.business_name, description: s.business_description, phone: s.business_phone, address: s.business_address },
      settings: s,
      clinics: clinics.map((c) => ({ ...c, doctors: doctors.filter((d) => d.clinic_id === c.id).map(doctorPublic), services: services.filter((x) => x.clinic_id === c.id) })),
    });
  });
  app.get('/api/public/services', (req, res) => {
    const clinicId = req.query.clinicId ? Number(req.query.clinicId) : null;
    const rows = db.prepare('SELECT id, clinic_id, name, description, price, duration_minutes FROM services WHERE is_active = 1 AND clinic_id IS NOT NULL ORDER BY id').all();
    res.json({ services: clinicId ? rows.filter((r) => r.clinic_id === clinicId) : rows });
  });
  app.get('/api/public/slots', (req, res) => {
    try { res.json(listSlots({ date: req.query.date, doctorId: req.query.doctorId, serviceId: req.query.serviceId })); }
    catch (error) { res.status(error.status || 400).json({ error: error.message || 'تعذر تحميل المواعيد.' }); }
  });

  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
      filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${{ 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[file.mimetype] || '.bin'}`),
    }),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype) ? cb(null, true) : cb(new Error('صيغة الصورة غير مدعومة. استخدم JPG أو PNG أو WEBP.'))),
  });

  // Loads and cross-checks doctor + service (+ their clinic) for any booking write.
  function resolveBookable(doctorId, serviceId, { allowInactive = false } = {}) {
    const doctor = db.prepare('SELECT * FROM doctors WHERE id = ?').get(Number(doctorId));
    const service = db.prepare('SELECT * FROM services WHERE id = ?').get(Number(serviceId));
    if (!doctor || (!allowInactive && !doctor.is_active)) throw bad('الدكتور غير متاح حاليًا.');
    if (!service || (!allowInactive && !service.is_active)) throw bad('الخدمة غير متاحة حاليًا.');
    if (!service.clinic_id || service.clinic_id !== doctor.clinic_id) throw bad('الخدمة دي مش تابعة لعيادة الدكتور المختار.');
    const clinic = db.prepare('SELECT * FROM clinics WHERE id = ?').get(doctor.clinic_id);
    if (!clinic || (!allowInactive && !clinic.is_active)) throw bad('العيادة غير متاحة حاليًا.');
    return { doctor, service, clinic };
  }

  // ---------- Customer bookings ----------
  app.post('/api/bookings', requireAuth, (req, res, next) => upload.single('receipt')(req, res, (error) => {
    if (error) return res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'حجم صورة الإيصال يجب ألا يزيد عن 5 ميجابايت.' : (error.message || 'تعذر رفع الصورة.') });
    next();
  }), (req, res) => {
    let savedFilename = req.file?.filename;
    try {
      if (req.user.role !== 'customer') throw bad('الحجز متاح لحسابات العملاء فقط.', 403);
      const date = String(req.body.date || '');
      const time = String(req.body.time || '');
      const customerNote = String(req.body.note || '').slice(0, 500);
      const settings = settingsRow();
      const { doctor, service, clinic } = resolveBookable(req.body.doctorId, req.body.serviceId);
      if (!isValidDate(date) || date < todayLocal()) throw bad('اختر تاريخًا صحيحًا في اليوم أو المستقبل.');
      if (!/^\d{2}:\d{2}$/.test(time)) throw bad('اختار ميعادًا صحيحًا.');
      if (settings.deposit_required && !savedFilename) throw bad('ارفع صورة إيصال العربون لتأكيد طلب الحجز.');
      if (settings.deposit_required && !String(settings.payment_instructions || '').trim()) throw bad('الدفع بالعربون غير جاهز بعد. تواصل مع المبنى أو حاول لاحقًا.');
      const closed = closureFor(date, doctor.id);
      if (closed) throw bad(`${closed}. اختار يومًا آخر.`, 409);
      if (!listSlots({ date, doctorId: doctor.id, serviceId: service.id }).slots.some((s) => s.time === time && s.available)) throw bad('الموعد ده لم يعد متاحًا. اختار موعدًا آخر.', 409);
      const status = settings.deposit_required ? 'pending_review' : 'confirmed';
      const paymentStatus = settings.deposit_required ? 'pending_review' : 'not_required';
      const create = db.transaction(() => {
        const start = toMinutes(time);
        const conflict = db.prepare(`SELECT start_time, duration_minutes FROM bookings WHERE doctor_id = ? AND booking_date = ? AND status != 'cancelled'`).all(doctor.id, date)
          .some((b) => { const other = toMinutes(b.start_time); return start < other + Number(b.duration_minutes) && start + service.duration_minutes > other; });
        if (conflict) throw bad('تم حجز الموعد للتو. اختار موعدًا آخر.', 409);
        const result = db.prepare(`INSERT INTO bookings
          (code, user_id, service_id, clinic_id, doctor_id, customer_name, customer_phone, booking_date, start_time, duration_minutes, price_snapshot, deposit_amount, status, payment_status, receipt_filename, customer_note)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(makeCode(), req.user.id, service.id, clinic.id, doctor.id, req.user.name, req.user.phone, date, time, service.duration_minutes, service.price,
            settings.deposit_required ? settings.deposit_amount : 0, status, paymentStatus, savedFilename || null, customerNote);
        addEvent(result.lastInsertRowid, req.user.id, 'created', settings.deposit_required ? 'الحجز ينتظر مراجعة إيصال العربون.' : 'تم تأكيد الحجز بدون عربون.');
        return result.lastInsertRowid;
      });
      const id = create.immediate();
      savedFilename = null;
      return res.status(201).json({ booking: bookingView(db.prepare(`${bookingSelect} WHERE b.id = ?`).get(id)) });
    } catch (error) {
      safeUnlink(savedFilename);
      return res.status(error.status || 500).json({ error: error.status ? error.message : 'تعذر إنشاء الحجز.' });
    }
  });
  app.get('/api/bookings/mine', requireAuth, (req, res) => {
    res.json({ bookings: db.prepare(`${bookingSelect} WHERE b.user_id = ? ORDER BY b.booking_date DESC, b.start_time DESC`).all(req.user.id).map(bookingView) });
  });
  app.post('/api/bookings/:id/cancel', requireAuth, handle((req, res) => {
    const id = Number(req.params.id);
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ? AND user_id = ?').get(id, req.user.id);
    if (!booking) throw bad('الحجز غير موجود.', 404);
    if (!['pending_payment', 'pending_review', 'confirmed'].includes(booking.status)) throw bad('لا يمكن إلغاء الحجز في حالته الحالية.');
    db.prepare(`UPDATE bookings SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?`).run(id);
    addEvent(id, req.user.id, 'cancelled_by_customer', 'ألغى العميل الحجز من حسابه.');
    res.json({ ok: true });
  }));

  // ---------- Admin: summary & bookings ----------
  app.get('/api/admin/summary', ...adminOnly, (_req, res) => {
    const today = todayLocal();
    const c = db.prepare(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN booking_date = ? AND status != 'cancelled' THEN 1 ELSE 0 END) AS today,
      SUM(CASE WHEN status = 'pending_review' THEN 1 ELSE 0 END) AS pending_review,
      SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) AS confirmed,
      SUM(CASE WHEN status = 'checked_in' THEN 1 ELSE 0 END) AS checked_in FROM bookings`).get(today);
    const byClinic = db.prepare(`SELECT c.id AS clinicId, c.name AS name, c.floor AS floor,
      (SELECT COUNT(*) FROM doctors d WHERE d.clinic_id = c.id AND d.is_active = 1) AS doctors,
      COALESCE(SUM(CASE WHEN b.booking_date = ? AND b.status != 'cancelled' THEN 1 ELSE 0 END), 0) AS today,
      COALESCE(SUM(CASE WHEN b.booking_date >= ? AND b.status IN ('pending_review','confirmed','checked_in') THEN 1 ELSE 0 END), 0) AS upcoming
      FROM clinics c LEFT JOIN bookings b ON b.clinic_id = c.id WHERE c.is_active = 1 GROUP BY c.id ORDER BY c.sort_order, c.id`).all(today, today);
    res.json({ total: c.total || 0, today: c.today || 0, pendingReview: c.pending_review || 0, confirmed: c.confirmed || 0, checkedIn: c.checked_in || 0, byClinic });
  });
  app.get('/api/admin/bookings', ...adminOnly, handle((req, res) => {
    const status = String(req.query.status || 'all');
    const search = String(req.query.search || '').trim().slice(0, 80);
    if (status !== 'all' && !BOOKING_STATUSES.includes(status)) throw bad('فلتر الحالة غير صحيح.');
    let sql = `${bookingSelect} WHERE 1 = 1`;
    const params = [];
    if (status !== 'all') { sql += ' AND b.status = ?'; params.push(status); }
    if (req.query.clinicId) { sql += ' AND b.clinic_id = ?'; params.push(Number(req.query.clinicId)); }
    if (req.query.doctorId) { sql += ' AND b.doctor_id = ?'; params.push(Number(req.query.doctorId)); }
    if (search) {
      sql += ' AND (b.code LIKE ? OR b.customer_name LIKE ? OR b.customer_phone LIKE ? OR s.name LIKE ? OR d.name LIKE ? OR c.name LIKE ?)';
      const needle = `%${search}%`; params.push(needle, needle, needle, needle, needle, needle);
    }
    sql += ' ORDER BY b.booking_date DESC, b.start_time DESC LIMIT 300';
    res.json({ bookings: db.prepare(sql).all(...params).map(bookingView) });
  }));
  app.get('/api/admin/bookings/:id/receipt', ...adminOnly, (req, res) => {
    const booking = db.prepare('SELECT receipt_filename FROM bookings WHERE id = ?').get(Number(req.params.id));
    if (!booking || !booking.receipt_filename) return res.status(404).json({ error: 'لا توجد صورة إيصال لهذا الحجز.' });
    const fullPath = path.join(UPLOAD_DIR, path.basename(booking.receipt_filename));
    if (!fs.existsSync(fullPath)) return res.status(404).json({ error: 'ملف الإيصال غير موجود على الخادم.' });
    res.setHeader('Cache-Control', 'private, no-store');
    res.sendFile(fullPath);
  });
  app.post('/api/admin/bookings/:id/payment-review', ...adminOnly, handle((req, res) => {
    const id = Number(req.params.id);
    const decision = String(req.body?.decision || '');
    const note = String(req.body?.note || '').slice(0, 400);
    if (!['approve', 'reject'].includes(decision)) throw bad('اختيار المراجعة غير صحيح.');
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
    if (!booking) throw bad('الحجز غير موجود.', 404);
    if (booking.payment_status !== 'pending_review' || !booking.receipt_filename) throw bad('الحجز لا ينتظر مراجعة إيصال حاليًا.');
    db.transaction(() => {
      if (decision === 'approve') db.prepare(`UPDATE bookings SET status = 'confirmed', payment_status = 'approved', admin_note = ?, updated_at = datetime('now') WHERE id = ?`).run(note, id);
      else db.prepare(`UPDATE bookings SET status = 'cancelled', payment_status = 'rejected', admin_note = ?, updated_at = datetime('now') WHERE id = ?`).run(note || 'لم يتم اعتماد صورة الإيصال.', id);
      addEvent(id, req.user.id, decision === 'approve' ? 'payment_approved' : 'payment_rejected', note);
    })();
    res.json({ ok: true });
  }));
  const paymentAfter = (booking, status) => (status === 'confirmed' && booking.deposit_amount > 0 && booking.payment_status === 'pending_review' ? 'approved'
    : (status === 'cancelled' && booking.payment_status === 'pending_review' ? 'rejected' : booking.payment_status));
  app.post('/api/admin/bookings/:id/status', ...adminOnly, handle((req, res) => {
    const id = Number(req.params.id);
    const status = String(req.body?.status || '');
    const note = String(req.body?.note || '').slice(0, 400);
    if (!BOOKING_STATUSES.includes(status)) throw bad('حالة الحجز غير صحيحة.');
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
    if (!booking) throw bad('الحجز غير موجود.', 404);
    db.prepare(`UPDATE bookings SET status = ?, payment_status = ?, admin_note = ?, updated_at = datetime('now') WHERE id = ?`).run(status, paymentAfter(booking, status), note || booking.admin_note, id);
    addEvent(id, req.user.id, `status_${status}`, note);
    res.json({ ok: true });
  }));
  app.patch('/api/admin/bookings/:id', ...adminOnly, handle((req, res) => {
    const id = Number(req.params.id);
    const old = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
    if (!old) throw bad('الحجز غير موجود.', 404);
    const body = req.body || {};
    const customerName = String(body.customerName ?? old.customer_name).trim().slice(0, 100);
    const customerPhone = String(body.customerPhone ?? old.customer_phone).trim().slice(0, 30);
    const date = String(body.bookingDate ?? old.booking_date);
    const time = String(body.startTime ?? old.start_time);
    const doctorId = Number(body.doctorId ?? old.doctor_id);
    const serviceId = Number(body.serviceId ?? old.service_id);
    const price = body.price === undefined ? Number(old.price_snapshot) : Number(body.price);
    const status = String(body.status ?? old.status);
    const adminNote = String(body.adminNote ?? old.admin_note).slice(0, 500);
    if (customerName.length < 2 || customerPhone.length < 7) throw bad('راجع اسم العميل ورقم الموبايل.');
    if (!isValidDate(date) || !Number.isFinite(toMinutes(time))) throw bad('التاريخ أو الوقت غير صحيح.');
    if (!Number.isFinite(price) || price < 0 || price > 10000000) throw bad('السعر غير صحيح.');
    if (!BOOKING_STATUSES.includes(status)) throw bad('حالة الحجز غير صحيحة.');
    const { doctor, service, clinic } = resolveBookable(doctorId, serviceId, { allowInactive: true });
    if (status !== 'cancelled') {
      const closed = closureFor(date, doctor.id);
      if (closed) throw bad(closed, 409);
      const unchanged = date === old.booking_date && time === old.start_time && doctor.id === old.doctor_id;
      const slots = listSlots({ date, doctorId: doctor.id, serviceId: service.id, excludeBookingId: id, allowPast: unchanged }).slots;
      if (!slots.some((s) => s.time === time && s.available)) throw bad('الموعد المحدد غير متاح أو خارج ساعات عمل الدكتور.', 409);
    }
    try {
      db.transaction(() => {
        db.prepare(`UPDATE bookings SET customer_name = ?, customer_phone = ?, service_id = ?, clinic_id = ?, doctor_id = ?, booking_date = ?, start_time = ?, duration_minutes = ?, price_snapshot = ?, status = ?, payment_status = ?, admin_note = ?, updated_at = datetime('now') WHERE id = ?`)
          .run(customerName, customerPhone, service.id, clinic.id, doctor.id, date, time, service.duration_minutes, Math.round(price), status, paymentAfter(old, status), adminNote, id);
        addEvent(id, req.user.id, 'booking_edited', 'عدّل المسؤول بيانات الحجز.');
      }).immediate();
    } catch { throw bad('تعذر حفظ التعديلات. ربما تم حجز هذا الموعد في نفس اللحظة.', 409); }
    res.json({ ok: true });
  }));

  // ---------- Admin: clinics ----------
  const clinicFields = (body, old = {}) => {
    const name = String(body.name ?? old.name ?? '').trim();
    if (name.length < 2) throw bad('اسم العيادة مطلوب.');
    return {
      name: name.slice(0, 80),
      specialty: String(body.specialty ?? old.specialty ?? '').trim().slice(0, 80),
      description: String(body.description ?? old.description ?? '').trim().slice(0, 400),
      floor: String(body.floor ?? old.floor ?? '').trim().slice(0, 40),
      room: String(body.room ?? old.room ?? '').trim().slice(0, 20),
    };
  };
  app.get('/api/admin/clinics', ...adminOnly, (_req, res) => {
    const rows = db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM doctors d WHERE d.clinic_id = c.id AND d.is_active = 1) AS doctor_count FROM clinics c ORDER BY c.sort_order, c.id`).all();
    res.json({ clinics: rows.map((c) => ({ ...c, is_active: Boolean(c.is_active) })) });
  });
  app.post('/api/admin/clinics', ...adminOnly, handle((req, res) => {
    const f = clinicFields(req.body || {});
    const order = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM clinics').get().n;
    const id = Number(db.prepare('INSERT INTO clinics (name, specialty, description, floor, room, sort_order) VALUES (?, ?, ?, ?, ?, ?)').run(f.name, f.specialty, f.description, f.floor, f.room, order).lastInsertRowid);
    res.status(201).json({ id, ...f });
  }));
  app.patch('/api/admin/clinics/:id', ...adminOnly, handle((req, res) => {
    const id = Number(req.params.id);
    const old = db.prepare('SELECT * FROM clinics WHERE id = ?').get(id);
    if (!old) throw bad('العيادة غير موجودة.', 404);
    const f = clinicFields(req.body || {}, old);
    const active = req.body?.isActive === undefined ? old.is_active : (req.body.isActive ? 1 : 0);
    db.prepare('UPDATE clinics SET name = ?, specialty = ?, description = ?, floor = ?, room = ?, is_active = ? WHERE id = ?').run(f.name, f.specialty, f.description, f.floor, f.room, active, id);
    res.json({ ok: true });
  }));
  app.delete('/api/admin/clinics/:id', ...adminOnly, handle((req, res) => {
    const result = db.prepare('UPDATE clinics SET is_active = 0 WHERE id = ?').run(Number(req.params.id));
    if (!result.changes) throw bad('العيادة غير موجودة.', 404);
    res.json({ ok: true });
  }));

  // ---------- Admin: doctors ----------
  const optionalTime = (value, old) => {
    if (value === undefined) return old ?? null;
    if (value === null || value === '') return null;
    if (!Number.isFinite(toMinutes(value))) throw bad('وقت غير صحيح. استخدم صيغة 09:00.');
    return String(value);
  };
  function doctorFields(body, old = {}) {
    const name = String(body.name ?? old.name ?? '').trim();
    if (name.length < 2) throw bad('اسم الدكتور مطلوب.');
    const years = Number(body.yearsExperience ?? old.years_experience ?? 0);
    if (!Number.isInteger(years) || years < 0 || years > 70) throw bad('سنوات الخبرة غير صحيحة.');
    const opening = optionalTime(body.openingTime, old.opening_time);
    const closing = optionalTime(body.closingTime, old.closing_time);
    if ((opening && !closing) || (!opening && closing)) throw bad('حدد وقت البداية والنهاية معًا، أو اتركهما فارغين لاستخدام ساعات المبنى.');
    if (opening && toMinutes(opening) === toMinutes(closing)) throw bad('وقت البداية والنهاية لا يمكن أن يكونا متطابقين.');
    let interval = body.slotInterval === undefined ? old.slot_interval ?? null : (body.slotInterval === '' || body.slotInterval === null ? null : Number(body.slotInterval));
    if (interval !== null && (!Number.isInteger(interval) || interval < 10 || interval > 240)) throw bad('الفاصل بين المواعيد من 10 إلى 240 دقيقة.');
    return { name: name.slice(0, 80), title: String(body.title ?? old.title ?? '').trim().slice(0, 80), bio: String(body.bio ?? old.bio ?? '').trim().slice(0, 400), years, opening, closing, interval };
  }
  app.get('/api/admin/doctors', ...adminOnly, (_req, res) => {
    const rows = db.prepare('SELECT d.*, c.name AS clinic_name FROM doctors d JOIN clinics c ON c.id = d.clinic_id ORDER BY c.sort_order, d.id').all();
    const off = db.prepare("SELECT doctor_id, date, reason FROM doctor_days_off WHERE date >= ? ORDER BY date").all(todayLocal());
    res.json({ doctors: rows.map((d) => ({ ...d, is_active: Boolean(d.is_active), days_off: off.filter((o) => o.doctor_id === d.id) })) });
  });
  app.post('/api/admin/doctors', ...adminOnly, handle((req, res) => {
    const clinic = db.prepare('SELECT id FROM clinics WHERE id = ?').get(Number(req.body?.clinicId));
    if (!clinic) throw bad('اختار عيادة صحيحة للدكتور.');
    const f = doctorFields(req.body || {});
    const id = Number(db.prepare('INSERT INTO doctors (clinic_id, name, title, bio, years_experience, opening_time, closing_time, slot_interval) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(clinic.id, f.name, f.title, f.bio, f.years, f.opening, f.closing, f.interval).lastInsertRowid);
    res.status(201).json({ id, clinicId: clinic.id, name: f.name });
  }));
  app.patch('/api/admin/doctors/:id', ...adminOnly, handle((req, res) => {
    const id = Number(req.params.id);
    const old = db.prepare('SELECT * FROM doctors WHERE id = ?').get(id);
    if (!old) throw bad('الدكتور غير موجود.', 404);
    let clinicId = old.clinic_id;
    if (req.body?.clinicId !== undefined) {
      if (!db.prepare('SELECT id FROM clinics WHERE id = ?').get(Number(req.body.clinicId))) throw bad('اختار عيادة صحيحة للدكتور.');
      clinicId = Number(req.body.clinicId);
    }
    const f = doctorFields(req.body || {}, old);
    const active = req.body?.isActive === undefined ? old.is_active : (req.body.isActive ? 1 : 0);
    db.prepare('UPDATE doctors SET clinic_id = ?, name = ?, title = ?, bio = ?, years_experience = ?, opening_time = ?, closing_time = ?, slot_interval = ?, is_active = ? WHERE id = ?')
      .run(clinicId, f.name, f.title, f.bio, f.years, f.opening, f.closing, f.interval, active, id);
    res.json({ ok: true });
  }));
  app.delete('/api/admin/doctors/:id', ...adminOnly, handle((req, res) => {
    const result = db.prepare('UPDATE doctors SET is_active = 0 WHERE id = ?').run(Number(req.params.id));
    if (!result.changes) throw bad('الدكتور غير موجود.', 404);
    res.json({ ok: true });
  }));
  app.post('/api/admin/doctors/:id/days-off', ...adminOnly, handle((req, res) => {
    const id = Number(req.params.id);
    const date = String(req.body?.date || '');
    const reason = String(req.body?.reason || '').trim().slice(0, 200);
    if (!db.prepare('SELECT id FROM doctors WHERE id = ?').get(id)) throw bad('الدكتور غير موجود.', 404);
    if (!isValidDate(date) || date < todayLocal()) throw bad('اختر تاريخًا صحيحًا في المستقبل.');
    try { db.prepare('INSERT INTO doctor_days_off (doctor_id, date, reason) VALUES (?, ?, ?)').run(id, date, reason); }
    catch { throw bad('اليوم ده مسجل كإجازة للدكتور بالفعل.', 409); }
    res.status(201).json({ ok: true });
  }));
  app.delete('/api/admin/doctors/:id/days-off/:date', ...adminOnly, (req, res) => {
    db.prepare('DELETE FROM doctor_days_off WHERE doctor_id = ? AND date = ?').run(Number(req.params.id), String(req.params.date));
    res.json({ ok: true });
  });

  // ---------- Admin: services (belong to a clinic) ----------
  app.get('/api/admin/services', ...adminOnly, (_req, res) => {
    const rows = db.prepare('SELECT s.id, s.clinic_id, c.name AS clinic_name, s.name, s.description, s.price, s.duration_minutes, s.is_active FROM services s JOIN clinics c ON c.id = s.clinic_id ORDER BY c.sort_order, s.id').all();
    res.json({ services: rows.map((s) => ({ ...s, is_active: Boolean(s.is_active) })) });
  });
  function serviceFields(body, old = {}) {
    const name = String(body.name ?? old.name ?? '').trim();
    const price = Number(body.price ?? old.price);
    const duration = Number(body.durationMinutes ?? old.duration_minutes);
    if (name.length < 2) throw bad('اسم الخدمة مطلوب.');
    if (!Number.isFinite(price) || price < 0 || price > 10000000) throw bad('السعر غير صحيح.');
    if (!Number.isInteger(duration) || duration < 5 || duration > 480) throw bad('مدة الخدمة من 5 دقائق إلى 8 ساعات.');
    return { name: name.slice(0, 80), description: String(body.description ?? old.description ?? '').trim().slice(0, 500), price: Math.round(price), duration };
  }
  app.post('/api/admin/services', ...adminOnly, handle((req, res) => {
    const clinic = db.prepare('SELECT id FROM clinics WHERE id = ?').get(Number(req.body?.clinicId));
    if (!clinic) throw bad('اختار العيادة التابعة لها الخدمة.');
    const f = serviceFields(req.body || {});
    const id = Number(db.prepare('INSERT INTO services (clinic_id, name, description, price, duration_minutes, is_active) VALUES (?, ?, ?, ?, ?, 1)').run(clinic.id, f.name, f.description, f.price, f.duration).lastInsertRowid);
    res.status(201).json({ id });
  }));
  app.patch('/api/admin/services/:id', ...adminOnly, handle((req, res) => {
    const id = Number(req.params.id);
    const old = db.prepare('SELECT * FROM services WHERE id = ?').get(id);
    if (!old) throw bad('الخدمة غير موجودة.', 404);
    const f = serviceFields(req.body || {}, old);
    const active = req.body?.isActive === undefined ? old.is_active : (req.body.isActive ? 1 : 0);
    db.prepare('UPDATE services SET name = ?, description = ?, price = ?, duration_minutes = ?, is_active = ? WHERE id = ?').run(f.name, f.description, f.price, f.duration, active, id);
    res.json({ ok: true });
  }));
  app.delete('/api/admin/services/:id', ...adminOnly, handle((req, res) => {
    const result = db.prepare('UPDATE services SET is_active = 0 WHERE id = ?').run(Number(req.params.id));
    if (!result.changes) throw bad('الخدمة غير موجودة.', 404);
    res.json({ ok: true });
  }));

  // ---------- Admin: account, building settings, closures ----------
  app.post('/api/admin/account/password', ...adminOnly, handle((req, res) => {
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');
    const admin = db.prepare("SELECT id, password_hash FROM users WHERE id = ? AND role = 'admin'").get(req.user.id);
    if (!admin || !bcrypt.compareSync(currentPassword, admin.password_hash)) throw bad('كلمة المرور الحالية غير صحيحة.');
    if (newPassword.length < 10) throw bad('كلمة المرور الجديدة لازم تكون 10 أحرف على الأقل.');
    if (newPassword === currentPassword) throw bad('اختار كلمة مرور مختلفة عن الحالية.');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(newPassword, options.bcryptRounds ?? 12), req.user.id);
    res.json({ ok: true });
  }));
  app.put('/api/admin/settings', ...adminOnly, handle((req, res) => {
    const body = req.body || {};
    const old = settingsRow();
    const name = String(body.business_name ?? old.business_name).trim().slice(0, 100);
    const description = String(body.business_description ?? old.business_description).trim().slice(0, 400);
    const phone = String(body.business_phone ?? old.business_phone).trim().slice(0, 30);
    const address = String(body.business_address ?? old.business_address).trim().slice(0, 200);
    const opening = String(body.opening_time ?? old.opening_time);
    const closing = String(body.closing_time ?? old.closing_time);
    const interval = Number(body.slot_interval ?? old.slot_interval);
    const depositRequired = body.deposit_required === undefined ? old.deposit_required : (body.deposit_required ? 1 : 0);
    const depositAmount = Number(body.deposit_amount ?? old.deposit_amount);
    const instructions = String(body.payment_instructions ?? old.payment_instructions).trim().slice(0, 1000);
    const policy = String(body.cancellation_policy ?? old.cancellation_policy).trim().slice(0, 600);
    if (!name) throw bad('اسم المبنى مطلوب.');
    if (!Number.isFinite(toMinutes(opening)) || !Number.isFinite(toMinutes(closing)) || toMinutes(opening) === toMinutes(closing)) throw bad('حدد ساعات عمل صحيحة.');
    if (!Number.isInteger(interval) || interval < 10 || interval > 240) throw bad('الفاصل بين المواعيد من 10 إلى 240 دقيقة.');
    if (!Number.isFinite(depositAmount) || depositAmount < 0 || depositAmount > 10000000) throw bad('مبلغ العربون غير صحيح.');
    if (depositRequired && !instructions) throw bad('اكتب بيانات التحويل قبل تفعيل العربون.');
    db.prepare(`UPDATE settings SET business_name = ?, business_description = ?, business_phone = ?, business_address = ?, opening_time = ?, closing_time = ?, slot_interval = ?, deposit_required = ?, deposit_amount = ?, payment_instructions = ?, cancellation_policy = ?, updated_at = datetime('now') WHERE id = 1`)
      .run(name, description, phone, address, opening, closing, interval, depositRequired, Math.round(depositAmount), instructions, policy);
    res.json({ ok: true });
  }));
  app.get('/api/admin/blocked-dates', ...adminOnly, (_req, res) => res.json({ dates: db.prepare('SELECT date, reason FROM blocked_dates ORDER BY date').all() }));
  app.post('/api/admin/blocked-dates', ...adminOnly, handle((req, res) => {
    const date = String(req.body?.date || '');
    const reason = String(req.body?.reason || '').trim().slice(0, 200);
    if (!isValidDate(date) || date < todayLocal()) throw bad('اختر تاريخًا صحيحًا في المستقبل.');
    try { db.prepare('INSERT INTO blocked_dates (date, reason) VALUES (?, ?)').run(date, reason || 'إجازة'); }
    catch { throw bad('اليوم ده مسجل كإجازة بالفعل.', 409); }
    res.status(201).json({ ok: true });
  }));
  app.delete('/api/admin/blocked-dates/:date', ...adminOnly, (req, res) => {
    db.prepare('DELETE FROM blocked_dates WHERE date = ?').run(String(req.params.date));
    res.json({ ok: true });
  });
  // ---------- Admin: one-click backup (ZIP: data.json + bookings.csv + receipts/) ----------
  const backupLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: options.backupLimit ?? 20, standardHeaders: true, legacyHeaders: false, message: { error: 'طلبات نسخ احتياطي كثيرة. حاول بعد قليل.' } });
  const csvCell = (value) => {
    let text = String(value ?? '');
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`; // stop spreadsheet formula injection
    return `"${text.replaceAll('"', '""')}"`;
  };
  const statusAr = { pending_payment: 'في انتظار الدفع', pending_review: 'مراجعة العربون', confirmed: 'مؤكد', checked_in: 'وصل العميل', completed: 'مكتمل', cancelled: 'ملغي' };
  app.get('/api/admin/backup', ...adminOnly, backupLimiter, (_req, res, next) => {
    try {
      const all = (table) => db.prepare(`SELECT * FROM ${table}`).all();
      const users = all('users').map(({ password_hash, ...safe }) => safe); // never export password hashes
      const rows = db.prepare(`${bookingSelect} ORDER BY b.booking_date, b.start_time`).all();
      const files = {};
      let missingReceipts = 0;
      const bookings = rows.map((row) => {
        const entry = { ...row };
        delete entry.service_name; delete entry.clinic_name; delete entry.clinic_floor; delete entry.clinic_room; delete entry.doctor_name; delete entry.doctor_title;
        if (row.receipt_filename) {
          const safeName = path.basename(row.receipt_filename);
          try {
            const zipName = `receipts/${row.code}${path.extname(safeName)}`;
            files[zipName] = [new Uint8Array(fs.readFileSync(path.join(UPLOAD_DIR, safeName))), { level: 0 }];
            entry.receipt_zip_path = zipName;
          } catch { missingReceipts += 1; entry.receipt_zip_path = null; }
        }
        return entry;
      });
      const exportedAt = new Date().toISOString();
      const data = {
        exportedAt, app: 'dorak', note: 'كلمات المرور غير مضمّنة في النسخة الاحتياطية عمدًا.',
        counts: { bookings: bookings.length, receipts: Object.keys(files).length, missingReceipts },
        settings: all('settings'), clinics: all('clinics'), doctors: all('doctors'), doctorDaysOff: all('doctor_days_off'),
        services: all('services'), blockedDates: all('blocked_dates'), users, bookings, bookingEvents: all('booking_events'),
      };
      const header = ['كود الحجز', 'اسم العميل', 'الموبايل', 'العيادة', 'الدكتور', 'الخدمة', 'التاريخ', 'الوقت', 'المدة (دقيقة)', 'السعر', 'العربون', 'الحالة', 'ملاحظة العميل', 'ملاحظة الإدارة', 'تاريخ الإنشاء'];
      const csvRows = rows.map((r) => [r.code, r.customer_name, r.customer_phone, r.clinic_name, r.doctor_name, r.service_name, r.booking_date, r.start_time, r.duration_minutes, r.price_snapshot, r.deposit_amount, statusAr[r.status] || r.status, r.customer_note, r.admin_note, r.created_at]);
      const csv = `\uFEFF${[header, ...csvRows].map((line) => line.map(csvCell).join(',')).join('\r\n')}`;
      const readme = 'نسخة احتياطية من دورك.\r\n- data.json: كل البيانات (عيادات، أطباء، خدمات، حجوزات، سجل الأحداث، العملاء بدون كلمات المرور).\r\n- bookings.csv: الحجوزات بشكل يفتح مباشرة في Excel.\r\n- receipts/: صور إيصالات العربون باسم كود الحجز.\r\nاحفظ الملف في مكان آمن وخاص: فيه بيانات عملاء.\r\n';
      const zipped = zipSync({ 'data.json': strToU8(JSON.stringify(data, null, 2)), 'bookings.csv': strToU8(csv), 'README.txt': strToU8(readme), ...files });
      res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="dorak-backup-${todayLocal()}.zip"`, 'Cache-Control': 'no-store' });
      res.send(Buffer.from(zipped));
    } catch (error) { next(error); }
  });

  app.get('/api/admin/slots', ...adminOnly, (req, res) => {
    try { res.json(listSlots({ date: req.query.date, doctorId: req.query.doctorId, serviceId: req.query.serviceId, excludeBookingId: req.query.excludeBookingId })); }
    catch (error) { res.status(error.status || 400).json({ error: error.message || 'تعذر تحميل المواعيد.' }); }
  });

  // Production frontend. In development Vite serves the UI and proxies /api.
  if (isProduction) {
    const clientDist = path.join(__dirname, '..', 'client', 'dist');
    if (fs.existsSync(clientDist)) {
      app.use(express.static(clientDist));
      app.get('*', (req, res, next) => (req.path.startsWith('/api/') ? next() : res.sendFile(path.join(clientDist, 'index.html'))));
    }
  }
  app.use((err, _req, res, _next) => {
    if (!quiet) console.error(err);
    if (res.headersSent) return;
    res.status(500).json({ error: 'حصل خطأ غير متوقع على الخادم.' });
  });

  return { app, db, config: { PORT: Number(process.env.PORT || 4000), ADMIN_PASSWORD, JWT_SECRET } };
}

module.exports = { createApp };
