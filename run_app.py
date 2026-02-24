import subprocess
import os
import sys
import signal
import time

def run_app():
    # Detect Paths
    base_dir = os.path.dirname(os.path.abspath(__file__))
    frontend_dir = os.path.join(base_dir, "frontend")

    print("🚀 Starting Telltale AI Production Suite...")

    # 1. Start Backend (FastAPI)
    print("📦 Starting Backend (Port 8000)...")
    backend_proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"],
        cwd=base_dir
    )

    # 2. Wait a moment for backend
    time.sleep(2)

    # 3. Start Frontend (Vite)
    print("💻 Starting Frontend (Port 5173)...")
    # Check if we should use 'npm.cmd' on Windows
    npm_cmd = "npm.cmd" if os.name == "nt" else "npm"
    frontend_proc = subprocess.Popen(
        [npm_cmd, "run", "dev"],
        cwd=frontend_dir
    )

    print("\n✅ Both services are running!")
    print("🔗 Frontend: http://localhost:5173")
    print("🔗 Backend API: http://localhost:8000")
    print("\nPress Ctrl+C to stop both services.\n")

    try:
        # Keep the script alive while processes are running
        while True:
            time.sleep(1)
            if backend_proc.poll() is not None or frontend_proc.poll() is not None:
                break
    except KeyboardInterrupt:
        print("\n🛑 Stopping services...")
    finally:
        # Cleanup processes
        backend_proc.terminate()
        frontend_proc.terminate()
        print("👋 Environment stopped.")

if __name__ == "__main__":
    run_app()
