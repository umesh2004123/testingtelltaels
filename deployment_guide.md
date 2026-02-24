# Deployment Guide: Telltale AI Production Suite

This guide explains how to take your local application and deploy it to the cloud for anyone to use.

---

## 1. Frontend (React/Vite) -> [Netlify](https://www.netlify.com/)

Netlify is perfect for hosting the frontend.

### Steps:
1.  **Build the Project**: Run `npm run build` inside the `frontend` folder.
2.  **Upload to Netlify**:
    -   Go to [Netlify Dashboard](https://app.netlify.com/).
    -   Click "Add new site" -> "Deploy manually".
    -   Drag and drop the **`frontend/dist`** folder.
3.  **Configure API URL**:
    -   In Netlify Site Settings, go to **Environment Variables**.
    -   **Important**: You need to update `VITE_API_URL` in your frontend code (or `.env`) to point to your *live backend URL* instead of `localhost`.

---

## 2. Backend (FastAPI/Python) -> [Render](https://render.com/) or [Railway](https://railway.app/)

Since your backend uses TensorFlow (which is large), you need a host that supports Python and high memory.

### Steps for Render:
1.  **Create a New Web Service**: Connect your GitHub repository.
2.  **Build Command**: `pip install -r requirements.txt`
3.  **Start Command**: `uvicorn main:app --host 0.0.0.0 --port $PORT`
4.  **Hardware Note**: TensorFlow requires at least 2GB of RAM. We recommend the "Starter" plan or higher.

---

## 3. Automation (Local Use)

Instead of running separate commands, we created **`run_app.py`** in the root directory.

### How to use:
Run this single command from your terminal:
```bash
python run_app.py
```
This will automatically launch the Backend, then the Frontend, and show you the links in one window. Press `Ctrl+C` to stop both at once.

---

## 4. Production Tips
-   **HTTPS**: Both Netlify and Render provide HTTPS automatically.
-   **Security**: Your CORS is currently set to `*`. Once deployed, you should change `allow_origins` in `main.py` to your specific Netlify URL for better security.
