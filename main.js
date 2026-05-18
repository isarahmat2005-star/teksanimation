const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { exiftool } = require('exiftool-vendored');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 700,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile('index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', async () => {
  await exiftool.end();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Handler untuk memilih folder asal dan tujuan
ipcMain.handle('browse-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  return result.filePaths[0] || null;
});

// Handler untuk memilih file JSON
ipcMain.handle('browse-json', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'JSON Files', extensions: ['json'] }]
  });
  return result.filePaths[0] || null;
});

// Logika utama pemrosesan metadata (Asynchronous & Anti-Lag)
ipcMain.on('execute-injection', async (event, data) => {
  const { sourceDir, targetDir, jsonPath, deleteOriginal } = data;

  if (!sourceDir || !targetDir || !jsonPath) {
    event.reply('log-to-ui', 'Error: Path asal, tujuan, dan JSON wajib diisi!', 'error');
    return;
  }

  try {
    event.reply('log-to-ui', 'Mulai membaca file JSON...', 'info');
    const rawData = fs.readFileSync(jsonPath, 'utf8');
    const records = JSON.parse(rawData);
    event.reply('log-to-ui', `JSON selesai dimuat. Menemukan ${records.length} baris data.`, 'info');

    for (const record of records) {
      // Menyesuaikan dengan struktur JSON (record.name untuk filename)
      const filename = record.name || record.filename || record.Filename || record.file || record.File;
      
      // Mengambil data dari object "metadata"
      const meta = record.metadata || {};
      const title = meta.title_en || record.title || record.Title || record.name || record.Name;
      const description = meta.description_en || record.description || record.Description || record.desc || record.Desc || title;
      const keywordsRaw = meta.keywords_en || record.keywords || record.Keywords || record.tags || record.Tags || [];

      if (!filename) {
        event.reply('log-to-ui', '⚠️ Baris dilewati: Kolom nama file tidak ditemukan.', 'error');
        continue;
      }

      const srcPath = path.join(sourceDir, filename);
      const destPath = path.join(targetDir, filename);

      if (!fs.existsSync(srcPath)) {
        event.reply('log-to-ui', `⚠️ File tidak ditemukan di folder asal: ${filename}`, 'error');
        continue;
      }

      // Copy file ke folder tujuan terlebih dahulu agar aman
      fs.copyFileSync(srcPath, destPath);

      // Parsing keywords menjadi array bersih
      const tags = Array.isArray(keywordsRaw) ? keywordsRaw : keywordsRaw.split(',').map(t => t.trim()).filter(t => t.length > 0);

      // Menyiapkan 3 kategori
      const catAdobe = meta.category_adobe || '';
      const catShutterstock = meta.category_shutterstock || '';
      const catDreamstime = Array.isArray(meta.category_dreamstime) ? meta.category_dreamstime.join(', ') : (meta.category_dreamstime || '');
      const combinedCategories = [catAdobe, catShutterstock, catDreamstime].filter(Boolean).join('; ');

      // Inject menggunakan ExifTool (Kompatibel penuh dengan JPG, PNG, EPS Vektor)
      await exiftool.write(destPath, {
        Title: title,
        Description: description,
        Keywords: tags,
        'IPTC:ObjectName': title,
        'IPTC:Caption-Abstract': description,
        'IPTC:Keywords': tags,
        'XMP:Category': combinedCategories,
        'XMP:Instructions': combinedCategories
      });

      event.reply('log-to-ui', `✅ Sukses di-inject: ${filename}`, 'success');

      // Fitur hapus file asal jika dicentang dan injeksi sukses
      if (deleteOriginal) {
        fs.unlinkSync(srcPath);
        event.reply('log-to-ui', `🗑️ File asal berhasil dihapus: ${filename}`, 'info');
      }
    }

    event.reply('log-to-ui', '🏁 SEMUA PROSES SELESAI!', 'success');
  } catch (err) {
    event.reply('log-to-ui', `❌ Gagal memproses: ${err.message}`, 'error');
  }
});
