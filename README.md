# Memoria – Angular + Backend

## Einmalige Installation

Im Projektordner:

```powershell
npm run setup
```

## Start

```powershell
npm run dev
```

Danach öffnen:

- Frontend: http://localhost:4200
- Backend: http://localhost:3000/api/health

Beim ersten Start auf **Registrieren** klicken. Danach können Erinnerungen mit Fotos, Videos und Audio dauerhaft gespeichert werden. **Abmelden** befindet sich links unter Einstellungen.

## Speicherung

- Benutzer, Einstellungen und Erinnerungen: `backend/data/db.json`
- Fotos: `backend/uploads/photos`
- Videos: `backend/uploads/videos`
- Audio: `backend/uploads/audio`

Für eine Sicherung diese beiden Ordner kopieren. Die Datei `backend/.env` enthält nur ein lokales Entwicklungsgeheimnis und darf nicht öffentlich veröffentlicht werden.
