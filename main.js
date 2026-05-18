const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
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

// Handler untuk memilih file CSV
ipcMain.handle('browse-csv', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'CSV Files', extensions: ['csv'] }]
  });
  return result.filePaths[0] || null;
});

// Logika utama pemrosesan metadata (Asynchronous & Anti-Lag)
ipcMain.on('execute-injection', async (event, data) => {
  const { sourceDir, targetDir, csvPath, deleteOriginal } = data;

  if (!sourceDir || !targetDir || !csvPath) {
    event.reply('log-to-ui', 'Error: Path asal, tujuan, dan CSV wajib diisi!', 'error');
    return;
  }

  event.reply('log-to-ui', 'Mulai membaca file CSV...', 'info');
  const records = [];

  fs.createReadStream(csvPath)
    .pipe(csv())
    .on('data', (row) => records.push(row))
    .on('end', async () => {
      event.reply('log-to-ui', `CSV selesai dimuat. Menemukan ${records.length} baris data.`, 'info');

      for (const record of records) {
        // Toleransi penamaan kolom di CSV (case-insensitive)
        const filename = record.filename || record.Filename || record.file || record.File;
        const title = record.title || record.Title || record.name || record.Name;
        const description = record.description || record.Description || record.desc || record.Desc || title;
        const keywordsRaw = record.keywords || record.Keywords || record.tags || record.Tags || '';

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

        try {
          // Copy file ke folder tujuan terlebih dahulu agar aman
          fs.copyFileSync(srcPath, destPath);

          // Parsing keywords menjadi array bersih
          const tags = keywordsRaw.split(',').map(t => t.trim()).filter(t => t.length > 0);

          // Inject menggunakan ExifTool (Kompatibel penuh dengan JPG, PNG, EPS Vektor)
          await exiftool.write(destPath, {
            Title: title,
            Description: description,
            Keywords: tags,
            'IPTC:ObjectName': title,
            'IPTC:Caption-Abstract': description,
            'IPTC:Keywords': tags
          });

          event.reply('log-to-ui', `✅ Sukses di-inject: ${filename}`, 'success');

          // Fitur hapus file asal jika dicentang dan injeksi sukses
          if (deleteOriginal) {
            fs.unlinkSync(srcPath);
            event.reply('log-to-ui', `🗑️ File asal berhasil dihapus: ${filename}`, 'info');
          }

        } catch (err) {
          event.reply('log-to-ui', `❌ Gagal memproses ${filename}: ${err.message}`, 'error');
        }
      }

      event.reply('log-to-ui', '🏁 SEMUA PROSES SELESAI!', 'success');
    })
    .on('error', (err) => {
      event.reply('log-to-ui', `❌ Gagal membaca file CSV: ${err.message}`, 'error');
    });
});
