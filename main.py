import os
import json
import numpy as np
import pandas as pd
import tensorflow as tf
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from PIL import Image, ImageOps
import io
from typing import List
from datetime import datetime
from tensorflow.keras.applications.efficientnet import preprocess_input as efficientnet_preprocess

app = FastAPI(title="Telltale Prediction API")

# Enable CORS for frontend interaction
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configuration
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.join(BASE_DIR, "models")
ALLOWED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}

# Shared State
model = None
class_names = []
IMG_SIZE = (224, 224)
current_model_name = "14_telltael_v1"

def load_model_assets(model_name: str):
    global model, class_names, IMG_SIZE, current_model_name
    
    model_path = os.path.join(MODELS_DIR, model_name, "model.keras")
    class_map_path = os.path.join(MODELS_DIR, model_name, "class_map.json")
    
    if not os.path.exists(model_path):
        raise FileNotFoundError(f"Model file not found at {model_path}")
    if not os.path.exists(class_map_path):
        raise FileNotFoundError(f"Class map not found at {class_map_path}")
        
    print(f"Loading model: {model_name}...")
    
    # Load Model (using thread-safe or clearing current if memory is tight)
    new_model = tf.keras.models.load_model(model_path, compile=False)
    
    # Load Class Map
    with open(class_map_path, "r") as f:
        classes_dict = json.load(f)
        sorted_classes = sorted(classes_dict.items(), key=lambda item: item[1])
        new_class_names = [name for name, idx in sorted_classes]
    
    # Update Globals
    model = new_model
    class_names = new_class_names
    current_model_name = model_name
    
    # Auto-detect IMG_SIZE
    if model.input_shape and len(model.input_shape) == 4:
        IMG_SIZE = (model.input_shape[1], model.input_shape[2])
    
    print(f"Successfully loaded model '{model_name}' with {len(class_names)} classes.")

@app.on_event("startup")
async def startup_event():
    try:
        if not os.path.exists(MODELS_DIR):
            os.makedirs(MODELS_DIR)
        
        # Load default model if it exists
        if os.path.exists(os.path.join(MODELS_DIR, "14_telltael_v1")):
            load_model_assets("14_telltael_v1")
        else:
            print("WARNING: 'models/default' not found. Please upload a model.")
    except Exception as e:
        print(f"Startup Error: {str(e)}")

@app.get("/models")
async def list_models():
    if not os.path.exists(MODELS_DIR):
        return []
    
    available_models = []
    for d in os.listdir(MODELS_DIR):
        if os.path.isdir(os.path.join(MODELS_DIR, d)):
            # Check if it has required files
            if os.path.exists(os.path.join(MODELS_DIR, d, "model.keras")) and \
               os.path.exists(os.path.join(MODELS_DIR, d, "class_map.json")):
                available_models.append(d)
    
    return {
        "models": available_models,
        "current": current_model_name
    }

@app.post("/switch-model")
async def switch_model(name: str):
    try:
        load_model_assets(name)
        return {"status": "success", "model": name}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

def preprocess_image(img: Image.Image):
    print(f"DEBUG: Processing image mode={img.mode}, size={img.size}")
    # STEP 0: Handle Smart Transparency
    if img.mode != 'RGBA':
        img = img.convert('RGBA')

    # Analyze content brightness to decide background color
    np_img = np.array(img)
    alpha = np_img[:, :, 3]
    rgb = np_img[:, :, :3]
    mask = alpha > 10
    
    if mask.any():
        avg_content = np.mean(rgb[mask])
        print(f"DEBUG: Content brightness={avg_content}")
        if avg_content < 128:
            bg_color = (255, 255, 255)
            print("DEBUG: Using WHITE background")
        else:
            bg_color = (0, 0, 0)
            print("DEBUG: Using BLACK background")
    else:
        bg_color = (0, 0, 0)

    # Composite on selected background
    bg = Image.new("RGB", img.size, bg_color)
    bg.paste(img, mask=img.split()[3])
    img = bg

    # STEP 1: Convert to Grayscale
    gray_img = img.convert("L")

    # Invert if background is light
    w, h = gray_img.size
    corners = [
        gray_img.getpixel((0, 0)),
        gray_img.getpixel((w - 1, 0)),
        gray_img.getpixel((0, h - 1)),
        gray_img.getpixel((w - 1, h - 1))
    ]
    avg_bg = sum(corners) / 4
    print(f"DEBUG: Corner brightness={avg_bg}")
    if avg_bg > 127:
        print("DEBUG: Inverting image to get Light on Dark")
        gray_img = ImageOps.invert(gray_img)

    # STEP 2: Apply autocontrast
    gray_img = ImageOps.autocontrast(gray_img)

    # STEP 3: Convert grayscale to 3-channel
    np_img_gray = np.array(gray_img)
    rgb_like_img = np.stack([np_img_gray, np_img_gray, np_img_gray], axis=-1)

    # STEP 4: Resize
    pil_img = Image.fromarray(rgb_like_img)
    resized_img = pil_img.resize(IMG_SIZE, Image.BILINEAR)

    # STEP 5: Normalize and Preprocess for EfficientNet
    arr = np.array(resized_img).astype(np.float32)
    arr = np.expand_dims(arr, axis=0)
    arr = efficientnet_preprocess(arr)

    return arr

@app.post("/predict")
async def predict(file: UploadFile = File(...)):
    # 1. Validate File Extension
    if not file.filename.lower().endswith(".png"):
        raise HTTPException(status_code=400, detail="Only PNG images are allowed.")

    try:
        # 2. Read contents
        contents = await file.read()
        image = Image.open(io.BytesIO(contents))
        
        # 3. Preprocess
        input_data = preprocess_image(image)
        
        # 4. Predict
        predictions = model.predict(input_data)[0]
        
        # Get Top 5
        top_indices = np.argsort(predictions)[-5:][::-1]
        top5 = []
        for idx in top_indices:
            name = class_names[idx] if idx < len(class_names) else "Unknown"
            top5.append({
                "class": name,
                "confidence": float(predictions[idx])
            })
            
        confidence = float(predictions[top_indices[0]])
        predicted_class_name = top5[0]["class"]

        return {
            "prediction": predicted_class_name,
            "confidence": confidence,
            "filename": file.filename,
            "top5": top5
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Prediction failed: {str(e)}")

@app.post("/predict-batch")
async def predict_batch(files: List[UploadFile] = File(...)):
    results = []
    
    for file in files:
        if not file.filename.lower().endswith(".png"):
            continue # Skip non-pngs for batch
            
        try:
            contents = await file.read()
            image = Image.open(io.BytesIO(contents))
            
            input_data = preprocess_image(image)
            predictions = model.predict(input_data)[0]
            
            # Get Top 5
            top_indices = np.argsort(predictions)[-5:][::-1]
            top5 = []
            for idx in top_indices:
                name = class_names[idx] if idx < len(class_names) else "Unknown"
                top5.append({
                    "class": name,
                    "confidence": float(predictions[idx])
                })
            
            confidence = float(predictions[top_indices[0]])
            predicted_class_name = top5[0]["class"]
            
            results.append({
                "filename": file.filename,
                "prediction": predicted_class_name,
                "confidence": confidence,
                "status": "Success",
                "top5": top5
            })
        except Exception as e:
            results.append({
                "filename": file.filename,
                "prediction": "Error",
                "confidence": 0,
                "status": str(e)
            })
            
    return results

@app.post("/export-report")
async def export_report(results: List[dict], format: str = "xlsx"):
    try:
        if not results:
            raise HTTPException(status_code=400, detail="No results to export")
            
        df = pd.DataFrame(results)
        
        # Add production metadata
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        metadata = {
            "Export Timestamp": timestamp,
            "Total Images": len(results),
            "System": "Telltale AI Production v2.0",
            "Model": "EfficientNetB7-Batch"
        }
        
        buffer = io.BytesIO()
        
        if format.lower() == "xlsx":
            with pd.ExcelWriter(buffer, engine='openpyxl') as writer:
                df.to_excel(writer, index=False, sheet_name='Prediction Report')
                # Add metadata sheet
                meta_df = pd.DataFrame(list(metadata.items()), columns=["Field", "Value"])
                meta_df.to_excel(writer, index=False, sheet_name='Metadata')
            
            buffer.seek(0)
            return StreamingResponse(
                buffer,
                media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                headers={"Content-Disposition": f"attachment; filename=telltale_report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"}
            )
        else:
            # Default to CSV
            csv_str = df.to_csv(index=False)
            buffer.write(csv_str.encode())
            buffer.seek(0)
            return StreamingResponse(
                buffer,
                media_type="text/csv",
                headers={"Content-Disposition": f"attachment; filename=telltale_report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"}
            )
            
    except Exception as e:
        print(f"REPORT ERROR: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Report generation failed: {str(e)}")

@app.get("/health")
async def health():
    return {"status": "ok", "model_loaded": model is not None, "version": "2.0"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
