# FillWise Studio

## Create Windows EXE (Client Double-Click)

Use this flow to package the app into a single executable.

### Prerequisites
- Windows machine with Python installed and available in PATH
- Node.js and npm installed
- Project dependencies already installed

### Build Steps
1. Open PowerShell in the project root folder.
2. Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\build_client_exe.ps1
```

### Output
- The generated executable will be at:
	- `dist/FillWiseStudio.exe`

### Client Usage
- Send `dist/FillWiseStudio.exe` to the client.
- Client double-clicks the EXE to start the app.

### Runtime Notes
- MongoDB and Ollama must be installed/running (or reachable) on the client machine.
- Login credentials are controlled from backend `.env`:
	- `APP_LOGIN_USERNAME`
	- `APP_LOGIN_PASSWORD`
