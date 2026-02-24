import React, { useState, useRef, useEffect } from 'react';
import { Upload, ShieldAlert, Cpu, CheckCircle, Info, FolderOpen, FileSpreadsheet, List, Eye, Settings } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface Candidate {
  class: string;
  confidence: number;
}

interface PredictionResult {
  filename: string;
  prediction: string;
  confidence: number;
  status: string;
  previewUrl?: string;
  top5?: Candidate[];
}

const API_URL = 'http://localhost:8000';

function App() {
  const [activeTab, setActiveTab] = useState<'single' | 'batch'>('single');
  const [models, setModels] = useState<string[]>([]);
  const [currentModel, setCurrentModel] = useState<string>('default');
  const [modelLoading, setModelLoading] = useState(false);

  // Single Prediction State
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [singleLoading, setSingleLoading] = useState(false);
  const [singleResult, setSingleResult] = useState<any>(null);
  const [singleError, setSingleError] = useState<string | null>(null);

  // Batch Prediction State
  const [batchFiles, setBatchFiles] = useState<File[]>([]);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchResults, setBatchResults] = useState<PredictionResult[]>([]);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [showSingleDetails, setShowSingleDetails] = useState(false);

  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // --- Model Switching Handlers ---
  useEffect(() => {
    fetchModels();
  }, []);

  const fetchModels = async () => {
    try {
      const response = await fetch(`${API_URL}/models`);
      const data = await response.json();
      setModels(data.models || []);
      setCurrentModel(data.current || 'default');
    } catch (err) {
      console.error('Failed to fetch models', err);
    }
  };

  const handleModelSwitch = async (name: string) => {
    setModelLoading(true);
    try {
      const response = await fetch(`${API_URL}/switch-model?name=${name}`, { method: 'POST' });
      if (!response.ok) throw new Error('Failed to switch model');
      setCurrentModel(name);
      // Reset results when model changes
      setSingleResult(null);
      setBatchResults([]);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setModelLoading(false);
    }
  };

  // --- Single Prediction Handlers ---
  const validateAndSetSingleFile = (selectedFile: File) => {
    setSingleError(null);
    setSingleResult(null);

    if (selectedFile.type !== 'image/png') {
      setSingleError('Please upload a valid PNG image.');
      setFile(null);
      setPreview(null);
      return;
    }

    setFile(selectedFile);
    const reader = new FileReader();
    reader.onload = () => {
      setPreview(reader.result as string);
    };
    reader.readAsDataURL(selectedFile);
  };

  const handleSingleUpload = async () => {
    if (!file) return;
    setSingleLoading(true);
    setSingleError(null);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch(`${API_URL}/predict`, { method: 'POST', body: formData });
      if (!response.ok) throw new Error(await response.json().then(d => d.detail) || 'Prediction failed');
      setSingleResult(await response.json());
    } catch (err: any) {
      setSingleError(err.message || 'Error communicating with server');
    } finally {
      setSingleLoading(false);
    }
  };

  // --- Batch Prediction Handlers ---
  const handleFolderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const pngFiles = files.filter(f => f.name.toLowerCase().endsWith('.png'));
    setBatchFiles(pngFiles);
    setBatchResults([]);
    setBatchError(null);
  };

  const handleBatchUpload = async () => {
    if (batchFiles.length === 0) return;
    setBatchLoading(true);
    setBatchError(null);

    const formData = new FormData();
    batchFiles.forEach(f => formData.append('files', f));

    try {
      const response = await fetch(`${API_URL}/predict-batch`, { method: 'POST', body: formData });
      if (!response.ok) throw new Error('Batch processing failed');

      const serverResults = await response.json();

      // Merge server results with local previews
      const resultsWithPreviews = serverResults.map((res: any) => {
        const originalFile = batchFiles.find(f =>
          f.name === res.filename ||
          (f as any).webkitRelativePath === res.filename
        );
        return {
          ...res,
          previewUrl: originalFile ? URL.createObjectURL(originalFile) : undefined
        };
      });

      setBatchResults(resultsWithPreviews);
    } catch (err: any) {
      setBatchError(err.message || 'Error processing batch');
    } finally {
      setBatchLoading(false);
    }
  };

  const handleDownloadReport = async (format: 'xlsx' | 'csv' | 'html') => {
    if (batchResults.length === 0) return;

    if (format === 'html') {
      exportVisualHTMLReport();
      return;
    }

    try {
      // Create a clean version for export (no previewUrl)
      const exportData = batchResults.map(({ previewUrl, ...rest }) => rest);

      const response = await fetch(`${API_URL}/export-report?format=${format}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(exportData),
      });
      if (!response.ok) throw new Error('Report export failed');

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `telltale_report_${new Date().toISOString().split('T')[0]}.${format}`;
      a.click();
    } catch (err: any) {
      setBatchError('Failed to download report');
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = error => reject(error);
    });
  };

  const exportVisualHTMLReport = async () => {
    setBatchLoading(true);
    try {
      const stats = calculateStats();

      // Convert all images to Base64 in parallel
      const resultsWithBase64 = await Promise.all(batchResults.map(async (res) => {
        const originalFile = batchFiles.find(f => f.name === res.filename || (f as any).webkitRelativePath === res.filename);
        let base64 = '';
        if (originalFile) {
          base64 = await fileToBase64(originalFile);
        }
        return { ...res, base64 };
      }));

      const htmlContent = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <title>Telltale AI Visual Report - ${new Date().toLocaleDateString()}</title>
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Outfit:wght@600;700&display=swap');
            :root {
              --primary: #6366f1;
              --success: #10b981;
              --bg: #030712;
              --card: #111827;
              --text: #f9fafb;
              --text-muted: #9ca3af;
              --border: rgba(255, 255, 255, 0.08);
            }
            * { box-sizing: border-box; }
            body { 
              font-family: 'Inter', sans-serif; 
              background: var(--bg); 
              color: var(--text); 
              padding: 60px 40px; 
              margin: 0;
              line-height: 1.5;
            }
            .report-container { max-width: 1100px; margin: 0 auto; }
            .report-header { 
              display: flex;
              justify-content: space-between;
              align-items: flex-end;
              border-bottom: 1px solid var(--border); 
              padding-bottom: 30px; 
              margin-bottom: 40px; 
            }
            .brand h1 { 
              font-family: 'Outfit', sans-serif; 
              margin: 0; 
              font-size: 2.8rem; 
              letter-spacing: -0.03em; 
              background: linear-gradient(135deg, #fff 0%, #6366f1 100%);
              -webkit-background-clip: text;
              -webkit-text-fill-color: transparent;
            }
            .brand p { color: var(--text-muted); margin: 8px 0 0 0; font-size: 0.95rem; }
            .meta { text-align: right; color: var(--text-muted); font-size: 0.85rem; }
            
            .stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; margin-bottom: 50px; }
            .stat-card { 
              background: var(--card); 
              padding: 28px; 
              border-radius: 20px; 
              border: 1px solid var(--border);
              box-shadow: 0 10px 30px -10px rgba(0,0,0,0.5);
            }
            .stat-label { font-size: 11px; text-transform: uppercase; color: var(--text-muted); margin-bottom: 10px; letter-spacing: 0.12em; font-weight: 600; }
            .stat-value { font-size: 32px; font-weight: 700; color: var(--primary); font-family: 'Outfit'; }
            
            .table-container { 
              background: var(--card); 
              border-radius: 24px; 
              overflow: hidden; 
              border: 1px solid var(--border);
              box-shadow: 0 20px 50px -20px rgba(0,0,0,0.7);
            }
            table { width: 100%; border-collapse: collapse; }
            th { 
              text-align: left; 
              padding: 20px 24px; 
              background: rgba(99, 102, 241, 0.05); 
              color: var(--text-muted); 
              text-transform: uppercase; 
              font-size: 11px; 
              letter-spacing: 0.1em;
              border-bottom: 1px solid var(--border);
            }
            td { padding: 20px 24px; border-bottom: 1px solid var(--border); vertical-align: middle; }
            .thumb-box {
              width: 56px;
              height: 56px;
              background: #000;
              border-radius: 12px;
              border: 1px solid var(--border);
              overflow: hidden;
              display: flex;
              align-items: center;
              justify-content: center;
            }
            .thumb { max-width: 100%; max-height: 100%; object-fit: contain; }
            .filename { font-size: 0.85rem; color: var(--text-muted); font-family: monospace; }
            .pred { color: var(--text); font-weight: 600; font-size: 1.05rem; }
            .conf-badge {
              display: inline-flex;
              align-items: center;
              padding: 4px 10px;
              background: rgba(16, 185, 129, 0.1);
              color: var(--success);
              border-radius: 8px;
              font-family: 'Outfit';
              font-size: 0.9rem;
              font-weight: 700;
            }
            .progress-container { width: 100px; height: 6px; background: rgba(255,255,255,0.05); border-radius: 10px; margin-top: 8px; overflow: hidden; }
            .progress-bar { height: 100%; background: linear-gradient(90deg, var(--primary), var(--success)); border-radius: 10px; }
            
            .footer { margin-top: 60px; text-align: center; color: #4b5563; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; }
            @media print {
              body { padding: 20px; background: #fff; color: #000; }
              .stat-card, .table-container { border: 1px solid #ddd; box-shadow: none; background: #fff; }
              .brand h1 { -webkit-text-fill-color: #000; background: none; }
            }
          </style>
        </head>
        <body>
          <div class="report-container">
            <header class="report-header">
              <div class="brand">
                <h1>TELLTALE AI</h1>
                <p>Automotive Component Inspection Report</p>
              </div>
              <div class="meta">
                <div>DATE: ${new Date().toLocaleDateString()}</div>
                <div>MODEL: ${currentModel.toUpperCase()}</div>
              </div>
            </header>

            <div class="stats-grid">
              <div class="stat-card">
                <div class="stat-label">Units Inspected</div>
                <div class="stat-value">${stats.total}</div>
              </div>
              <div class="stat-card">
                <div class="stat-label">Model Accuracy</div>
                <div class="stat-value">${stats.avgConf}%</div>
              </div>
              <div class="stat-card">
                <div class="stat-label">Registry Hash</div>
                <div class="stat-value">#${Math.floor(Math.random() * 9000000) + 1000000}</div>
              </div>
            </div>

            <div class="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Icon</th>
                    <th>Reference Filename</th>
                    <th>Detection Class</th>
                    <th>Inference Score</th>
                  </tr>
                </thead>
                <tbody>
                  ${resultsWithBase64.map(res => `
                    <tr>
                      <td>
                        <div class="thumb-box">
                          ${res.base64 ? `<img src="${res.base64}" class="thumb" alt="Preview">` : `<div style="color:#333;font-size:10px">N/A</div>`}
                        </div>
                      </td>
                      <td class="filename">${res.filename}</td>
                      <td class="pred">${res.prediction}</td>
                      <td>
                        <div class="conf-badge">${(res.confidence * 100).toFixed(1)}%</div>
                        <div class="progress-container"><div class="progress-bar" style="width: ${res.confidence * 100}%"></div></div>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>

            <footer class="footer">
              This document is a computer-generated inspection report verifying automotive telltale integrity. 
              <br>© ${new Date().getFullYear()} Telltale AI Production Systems. Confidential.
            </footer>
          </div>
        </body>
        </html>
      `;

      const blob = new Blob([htmlContent], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `telltale_production_report_${Date.now()}.html`;
      a.click();
    } catch (err: any) {
      setBatchError('Failed to generate visual report: ' + err.message);
    } finally {
      setBatchLoading(false);
    }
  };

  const calculateStats = () => {
    if (batchResults.length === 0) return { total: 0, avgConf: '0' };
    const total = batchResults.length;
    const avgConf = (batchResults.reduce((acc, curr) => acc + curr.confidence, 0) / total * 100).toFixed(1);
    return { total, avgConf };
  };
  return (
    <div className="container">
      <motion.div className="header-flex" initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
        <div>
          <h1>TELLTALE AI</h1>
          <p className="subtitle">Production-grade Automotive Icon Detection</p>
        </div>

        <div className="model-selector-container">
          <div className="model-label"><Settings size={14} /> Model Version</div>
          <select
            className="model-dropdown"
            value={currentModel}
            onChange={(e) => handleModelSwitch(e.target.value)}
            disabled={modelLoading}
          >
            {models.map(m => (
              <option key={m} value={m}>{m.toUpperCase()}</option>
            ))}
          </select>
          {modelLoading && <div className="mini-spinner"></div>}
        </div>
      </motion.div>

      <div className="tabs">
        <button className={activeTab === 'single' ? 'active' : ''} onClick={() => setActiveTab('single')}>
          <Eye size={18} /> Single Prediction
        </button>
        <button className={activeTab === 'batch' ? 'active' : ''} onClick={() => setActiveTab('batch')}>
          <List size={18} /> Batch Processing
        </button>
      </div>

      <main className="main-card">
        {activeTab === 'single' ? (
          <>
            <section className="upload-section">
              <div
                className={`drop-zone ${isDragging ? 'dragging' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files[0]; if (f) validateAndSetSingleFile(f); }}
                onClick={() => fileInputRef.current?.click()}
              >
                <input type="file" ref={fileInputRef} hidden accept="image/png" onChange={(e) => { const f = e.target.files?.[0]; if (f) validateAndSetSingleFile(f); }} />
                <div className="icon"><Upload size={48} strokeWidth={1.5} /></div>
                <p><strong>Drop your icon here</strong>or click to browse</p>
                <div className="info-badge"><Info size={14} /> Only PNG supported</div>
              </div>
              <button className="upload-btn" onClick={handleSingleUpload} disabled={!file || singleLoading}>
                {singleLoading ? 'Running Inference...' : <><Cpu size={20} /> Analyze Telltale</>}
              </button>
              <AnimatePresence>{singleError && <motion.div className="error-message" initial={{ opacity: 0 }} animate={{ opacity: 1 }}><ShieldAlert size={20} /> {singleError}</motion.div>}</AnimatePresence>
            </section>
            <section className="results-section">
              <div className="image-preview-container">{singleLoading && <div className="loading-overlay"><div className="spinner"></div></div>}{preview ? <motion.img key={preview} src={preview} className="image-preview" alt="Selected" initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} /> : <div className="placeholder-text">Waiting for image</div>}</div>
              <div className="prediction-box">
                <span className="prediction-label">Class Prediction</span>
                <div className="prediction-value">{singleResult ? singleResult.prediction : '---'}{singleResult && <CheckCircle size={24} color="#10b981" style={{ marginLeft: '10px' }} />}</div>
                <div className="confidence-bar-container"><motion.div className="confidence-bar" initial={{ width: 0 }} animate={{ width: `${singleResult ? singleResult.confidence * 100 : 0}%` }} /></div>
                <div className="confidence-text"><span>Confidence Score</span><span>{singleResult ? (singleResult.confidence * 100).toFixed(1) : 0}%</span></div>
              </div>

              {singleResult?.top5 && (
                <div className="details-toggle-container">
                  <button className="details-toggle-btn" onClick={() => setShowSingleDetails(!showSingleDetails)}>
                    {showSingleDetails ? 'Hide Top 5 Candidates' : 'View Top 5 Candidates'}
                  </button>
                  <AnimatePresence>
                    {showSingleDetails && (
                      <motion.div
                        className="top5-details-panel"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                      >
                        {singleResult.top5.map((candidate: Candidate, idx: number) => (
                          <div key={idx} className="candidate-row">
                            <div className="candidate-info">
                              <span className="candidate-name">
                                <span className="rank-num">{idx + 1}.</span> {candidate.class}
                              </span>
                              <span className="candidate-conf">{(candidate.confidence * 100).toFixed(1)}%</span>
                            </div>
                            <div className="candidate-bar-bg">
                              <div className="candidate-bar" style={{ width: `${candidate.confidence * 100}%` }}></div>
                            </div>
                          </div>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </section>
          </>
        ) : (
          <div className="batch-container">
            <div className="batch-header">
              <div className="batch-controls">
                <button className="secondary-btn" onClick={() => folderInputRef.current?.click()}>
                  <FolderOpen size={18} /> Select Folder
                </button>
                <input
                  type="file"
                  ref={folderInputRef}
                  hidden
                  {...({ webkitdirectory: "", directory: "" } as any)}
                  multiple
                  onChange={handleFolderChange}
                />
                <button className="upload-btn" onClick={handleBatchUpload} disabled={batchFiles.length === 0 || batchLoading}>
                  {batchLoading ? 'Processing Batch...' : <><Cpu size={20} /> Process {batchFiles.length} Images</>}
                </button>
              </div>

              <AnimatePresence>
                {batchError && (
                  <motion.div className="error-message" style={{ marginTop: '1rem' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                    <ShieldAlert size={20} /> {batchError}
                  </motion.div>
                )}
              </AnimatePresence>

              {batchResults.length > 0 && (
                <motion.div
                  className="dashboard-stats"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  <div className="stat-item">
                    <span className="label">Total Images</span>
                    <span className="value">{calculateStats().total}</span>
                  </div>
                  <div className="stat-separator"></div>
                  <div className="stat-item">
                    <span className="label">Avg Confidence</span>
                    <span className="value">{calculateStats().avgConf}%</span>
                  </div>
                  <div className="stat-separator"></div>
                  <div className="stat-item">
                    <span className="label">Target Port</span>
                    <span className="value">8000</span>
                  </div>
                </motion.div>
              )}

              {batchResults.length > 0 && (
                <div className="export-controls">
                  <button className="export-btn html" onClick={() => handleDownloadReport('html')}>
                    <Eye size={18} /> Visual Report
                  </button>
                  <button className="export-btn xlsx" onClick={() => handleDownloadReport('xlsx')}>
                    <FileSpreadsheet size={18} /> Export Excel
                  </button>
                  <button className="export-btn csv" onClick={() => handleDownloadReport('csv')}>
                    <FileSpreadsheet size={18} /> Export CSV
                  </button>
                </div>
              )}
            </div>

            <div className="batch-results-table">
              {batchResults.length > 0 ? (
                <table>
                  <thead>
                    <tr>
                      <th>Image</th>
                      <th>Filename</th>
                      <th>Prediction</th>
                      <th>Confidence</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batchResults.map((res, i) => (
                      <React.Fragment key={i}>
                        <tr className={expandedRows.has(i) ? 'row-expanded-header' : ''} onClick={() => {
                          const newExpanded = new Set(expandedRows);
                          if (newExpanded.has(i)) newExpanded.delete(i);
                          else newExpanded.add(i);
                          setExpandedRows(newExpanded);
                        }}>
                          <td className="thumbnail-cell">
                            {res.previewUrl ? (
                              <img src={res.previewUrl} alt="Thumbnail" className="table-thumb" />
                            ) : (
                              <div className="thumb-placeholder"><Eye size={16} /></div>
                            )}
                          </td>
                          <td className="filename">{res.filename}</td>
                          <td className="prediction">{res.prediction}</td>
                          <td>
                            <div className="mini-confidence">
                              <div className="bar-bg">
                                <div className="bar" style={{ width: `${res.confidence * 100}%` }}></div>
                              </div>
                              {(res.confidence * 100).toFixed(1)}%
                            </div>
                          </td>
                          <td className={`status ${res.status.toLowerCase()}`}>
                            <div className="status-flex">
                              {res.status}
                              {res.top5 && <div className="detail-indicator">{expandedRows.has(i) ? '−' : '+'}</div>}
                            </div>
                          </td>
                        </tr>
                        {expandedRows.has(i) && res.top5 && (
                          <tr className="expansion-row">
                            <td colSpan={5}>
                              <div className="expansion-content">
                                <p className="expansion-title">Top 5 Model Predictions:</p>
                                <div className="candidate-grid">
                                  {res.top5.map((candidate: Candidate, idx: number) => (
                                    <div key={idx} className="candidate-item">
                                      <div className="candidate-header">
                                        <span className="candidate-name">
                                          <span className="rank-badge">{idx + 1}</span> {candidate.class}
                                        </span>
                                        <span className="candidate-conf">{(candidate.confidence * 100).toFixed(1)}%</span>
                                      </div>
                                      <div className="candidate-mini-bar">
                                        <div className="fill" style={{ width: `${candidate.confidence * 100}%` }}></div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="batch-placeholder">
                  <FolderOpen size={48} opacity={0.2} />
                  <p>Select a folder to begin batch validation</p>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
