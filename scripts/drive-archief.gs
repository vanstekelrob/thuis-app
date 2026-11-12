// Google Apps Script voor V70: zet foto's van een activiteit in een eigen mapje in de huis-Drive.
// Eenmalig instellen (zie README, kopje "Foto's naar Google Drive"):
//   1. script.google.com → Nieuw project → plak dit bestand.
//   2. Projectinstellingen → Scripteigenschappen: MAP_ID = id van de huismap, TOKEN = een lange willekeurige tekst.
//   3. Implementeren → Nieuwe implementatie → Web-app, uitvoeren als: ik, toegang: iedereen.
//   4. De web-app-URL en hetzelfde TOKEN als Supabase-secrets DRIVE_SCRIPT_URL en DRIVE_SCRIPT_TOKEN.
function doPost(e) {
  const props = PropertiesService.getScriptProperties();
  const req = JSON.parse(e.postData.contents);
  if (!req.token || req.token !== props.getProperty('TOKEN')) return out({ ok: false, error: 'token' });
  const parent = DriveApp.getFolderById(props.getProperty('MAP_ID'));
  const name = String(req.folder || 'Activiteit').slice(0, 120);
  const found = parent.getFoldersByName(name);
  const folder = found.hasNext() ? found.next() : parent.createFolder(name);
  let saved = 0;
  (req.files || []).forEach((f) => {
    if (folder.getFilesByName(f.name).hasNext()) { saved++; return; } // al eerder gezet (herhaalde poging)
    const blob = UrlFetchApp.fetch(f.url).getBlob().setName(f.name);
    folder.createFile(blob);
    saved++;
  });
  return out({ ok: true, saved, folderUrl: folder.getUrl() });
}
const out = (o) => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
