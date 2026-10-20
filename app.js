require('dotenv').config();

const express = require('express');
const fetch = require('node-fetch');
const bodyParser = require('body-parser');
const session = require('express-session');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

// Konfigurasi GitHub
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;
const FILE_PATH = process.env.FILE_PATH;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${FILE_PATH}`;

const ADMIN_PASSWORD = process.env.PW_ADMIN_LOGIN;
const USER_PASSWORD = process.env.PW_USER_LOGIN;

const settings = {
  contact_whatsapp: process.env.CONTACT_OWNER,
  api_title: process.env.API_TITLE
};

// Middleware
app.set('trust proxy', 1);
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('public'));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(session({
  secret: 'rahasia-killua-database',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax'
  }
}));

app.get('/set', (req, res) => res.json(settings));

// Ambil data dari GitHub API
async function fetchData() {
  try {
    const res = await fetch(GITHUB_API_URL, {
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'User-Agent': 'Killua-Manager-App',
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    const json = await res.json();

    if (!res.ok || !json.content) {
      console.error('GitHub API Error (fetchData):', json);
      return [];
    }

    const content = Buffer.from(json.content, 'base64').toString('utf-8');
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('Gagal mengambil data:', err.message);
    return [];
  }
}

// Update data ke GitHub dengan validasi SHA dan hasil status commit
async function updateData(newData) {
  try {
    const currentRes = await fetch(GITHUB_API_URL, {
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'User-Agent': 'Killua-Manager-App',
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    const current = await currentRes.json();
    if (!current.sha) {
      console.error('Gagal mendapatkan SHA file:', current);
      return false;
    }

    const base64Content = Buffer.from(JSON.stringify(newData, null, 2)).toString('base64');

    const updateRes = await fetch(GITHUB_API_URL, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'User-Agent': 'Killua-Manager-App',
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github.v3+json'
      },
      body: JSON.stringify({
        message: 'Update database.json',
        content: base64Content,
        sha: current.sha
      })
    });

    const result = await updateRes.json();
    if (!updateRes.ok) {
      console.error('Gagal commit file ke GitHub:', result);
      return false;
    }

    return true;
  } catch (err) {
    console.error('Error saat updateData:', err.message);
    return false;
  }
}

// Middleware proteksi rute
function authMiddleware(req, res, next) {
  if (req.session && req.session.isAdmin) {
    return next();
  }
  res.redirect('/login-admin');
}

function authMiddlewareUser(req, res, next) {
  if (req.session && req.session.isUser) {
    return next();
  }
  res.redirect('/login');
}

// === ROUTES USER ===

app.get('/', authMiddlewareUser, async (req, res) => {
  const message = req.session.message;
  req.session.message = null;
  const data = await fetchData();
  res.render('user', { message, data });
});

app.get('/login', (req, res) => {
  const message = req.session.message;
  req.session.message = null;
  res.render('login', { message });
});

app.post('/login', (req, res) => {
  const { password } = req.body;
  if (password && String(password).trim() === String(USER_PASSWORD).trim()) {
    req.session.isUser = true;
    req.session.isAdmin = false;
    req.session.save(() => res.redirect('/'));
  } else {
    req.session.message = 'Sandi salah!';
    req.session.save(() => res.redirect('/login'));
  }
});

app.post('/add', authMiddlewareUser, async (req, res) => {
  let { number } = req.body;
  number = (number || '').replace(/[^0-9]/g, '');

  if (number.length < 8 || number.length > 15) {
    req.session.message = 'Nomor tidak valid (harus 8-15 digit)';
    return req.session.save(() => res.redirect('/'));
  }

  let data = await fetchData();
  if (!Array.isArray(data)) data = [];

  const alreadyExists = data.find(item => item.number === number);
  if (alreadyExists) {
    req.session.message = 'Nomor sudah terdaftar';
    return req.session.save(() => res.redirect('/'));
  }

  data.push({ number, status: 'active' });
  const success = await updateData(data);

  if (success) {
    req.session.message = 'Berhasil menambah nomor ✓';
  } else {
    req.session.message = 'Gagal menyimpan ke database GitHub!';
  }

  req.session.save(() => res.redirect('/'));
});

app.get('/logout-user', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// === ROUTES ADMIN ===

app.get('/admin', authMiddleware, async (req, res) => {
  const data = await fetchData();
  const message = req.session.message;
  req.session.message = null;
  res.render('admin', { data, message });
});

app.get('/login-admin', (req, res) => {
  const message = req.session.message;
  req.session.message = null;
  res.render('login-admin', { message });
});

app.post('/login-admin', (req, res) => {
  const { password } = req.body;
  if (password && String(password).trim() === String(ADMIN_PASSWORD).trim()) {
    req.session.isAdmin = true;
    req.session.isUser = false;
    req.session.save(() => res.redirect('/admin'));
  } else {
    req.session.message = 'Sandi salah!';
    req.session.save(() => res.redirect('/login-admin'));
  }
});

app.post('/admin-add', authMiddleware, async (req, res) => {
  let { number } = req.body;
  number = (number || '').replace(/[^0-9]/g, '');

  if (number.length < 8 || number.length > 15) {
    req.session.message = 'Nomor tidak valid (harus 8-15 digit)';
    return req.session.save(() => res.redirect('/admin'));
  }

  let data = await fetchData();
  if (!Array.isArray(data)) data = [];

  const alreadyExists = data.find(item => item.number === number);
  if (alreadyExists) {
    req.session.message = 'Nomor sudah terdaftar';
    return req.session.save(() => res.redirect('/admin'));
  }

  data.push({ number, status: 'active' });
  const success = await updateData(data);

  if (success) {
    req.session.message = 'Berhasil menambah nomor ✓';
  } else {
    req.session.message = 'Gagal menyimpan ke database GitHub!';
  }

  req.session.save(() => res.redirect('/admin'));
});

app.post('/delete', authMiddleware, async (req, res) => {
  const { number } = req.body;
  let data = await fetchData();
  data = data.filter(item => item.number !== number);
  await updateData(data);
  req.session.message = 'Berhasil menghapus nomor ✓';
  req.session.save(() => res.redirect('/admin'));
});

app.post('/blacklist', authMiddleware, async (req, res) => {
  const { number } = req.body;
  let data = await fetchData();
  data = data.map(item => item.number === number ? { ...item, status: 'blacklist' } : item);
  await updateData(data);
  req.session.message = 'Berhasil blacklist nomor ✓';
  req.session.save(() => res.redirect('/admin'));
});

app.post('/whitelist', authMiddleware, async (req, res) => {
  const { number } = req.body;
  let data = await fetchData();
  data = data.map(item => item.number === number ? { ...item, status: 'active' } : item);
  await updateData(data);
  req.session.message = 'Berhasil whitelist nomor ✓';
  req.session.save(() => res.redirect('/admin'));
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login-admin'));
});

// === API ENDPOINTS ===

app.get('/raw', async (req, res) => {
  const data = await fetchData();
  res.json(data);
});

app.get('/addnumber', async (req, res) => {
  let { number } = req.query;
  const data = await fetchData();
  number = (number || '').replace(/[^0-9]/g, '');

  if (!number || number.length < 8 || number.length > 15) {
    return res.json({ success: false, message: 'Nomor tidak valid' });
  }

  const alreadyExists = data.find(item => item.number === number);
  if (alreadyExists) {
    return res.json({ success: false, message: 'Nomor sudah terdaftar' });
  }

  data.push({ number, status: 'active' });
  const success = await updateData(data);
  if (!success) {
    return res.json({ success: false, message: 'Gagal memperbarui file di GitHub' });
  }
  res.json({ success: true, message: 'Berhasil menambah nomor ✓' });
});

app.get('/deletenumber', async (req, res) => {
  const { number } = req.query;
  let data = await fetchData();
  const exists = data.some(item => item.number === number);
  if (!exists) return res.json({ success: false, message: 'Nomor tidak ditemukan' });

  data = data.filter(item => item.number !== number);
  const success = await updateData(data);
  if (!success) {
    return res.json({ success: false, message: 'Gagal memperbarui file di GitHub' });
  }
  res.json({ success: true, message: 'Berhasil menghapus nomor ✓' });
});

app.get('/blacklistnumber', async (req, res) => {
  const { number } = req.query;
  let data = await fetchData();
  const exists = data.some(item => item.number === number);
  if (!exists) return res.json({ success: false, message: 'Nomor tidak ditemukan' });

  data = data.map(item => item.number === number ? { ...item, status: 'blacklist' } : item);
  const success = await updateData(data);
  if (!success) {
    return res.json({ success: false, message: 'Gagal memperbarui file di GitHub' });
  }
  res.json({ success: true, message: 'Berhasil blacklist nomor ✓' });
});

app.get('/whitelistnumber', async (req, res) => {
  const { number } = req.query;
  let data = await fetchData();
  const exists = data.some(item => item.number === number);
  if (!exists) return res.json({ success: false, message: 'Nomor tidak ditemukan' });

  data = data.map(item => item.number === number ? { ...item, status: 'active' } : item);
  const success = await updateData(data);
  if (!success) {
    return res.json({ success: false, message: 'Gagal memperbarui file di GitHub' });
  }
  res.json({ success: true, message: 'Berhasil whitelist nomor ✓' });
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));