import React, { useState } from 'react';
import axios from 'axios';
import { X, Database, Key, RefreshCw, CheckCircle2, AlertCircle, Sparkles } from 'lucide-react';

export default function UraIngestionModal({ isOpen, onClose, onIngestionComplete }) {
  const [accessKey, setAccessKey] = useState('');
  const [adminKey, setAdminKey] = useState(() => new URLSearchParams(window.location.search).get('key') || '');
  const [jsonInput, setJsonInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState(null);
  const [error, setError] = useState(null);
  const [importMode, setImportMode] = useState('api'); // 'api' or 'file'

  if (!isOpen) return null;

  const handleLiveIngestion = async (e) => {
    e.preventDefault();
    if (!accessKey.trim()) {
      setError('Please enter your URA Data Service Access Key.');
      return;
    }

    setLoading(true);
    setError(null);
    setStatusMessage('Connecting to URA Data Service backend pipeline...');

    const cleanKey = accessKey.trim();

    try {
      setStatusMessage('Requesting URA daily token & fetching sale transaction batches & rental quarters...');
      const backendRes = await axios.post('/api/ingest/ura', { accessKey: cleanKey }, {
        headers: adminKey ? { 'X-Admin-Key': adminKey } : {}
      });
      setStatusMessage(`Live URA API sync complete! Stored ${backendRes.data.totalRentalsIngested || 0} rental contracts and ${backendRes.data.totalSalesIngested || 0} sales caveats into property.db.`);
      onIngestionComplete();
    } catch (backendErr) {
      console.error('Backend URA ingestion error:', backendErr);
      setError(backendErr.response?.data?.error || backendErr.message || 'Failed to sync with URA API.');
    } finally {
      setLoading(false);
    }
  };

  const handleFileImport = async (e) => {
    e.preventDefault();
    if (!jsonInput.trim()) {
      setError('Please paste or select a URA JSON dataset export.');
      return;
    }

    setLoading(true);
    setError(null);
    setStatusMessage('Parsing and ingesting real URA contract dataset into SQLite database...');

    try {
      const parsed = JSON.parse(jsonInput);
      const res = await axios.post('/api/ingest/import-data', { jsonData: parsed }, {
        headers: adminKey ? { 'X-Admin-Key': adminKey } : {}
      });
      setStatusMessage(`Real URA Data Import complete! Successfully stored ${res.data.totalSalesIngested} sales and ${res.data.totalRentalsIngested} rental contracts into database.`);
      onIngestionComplete();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Invalid JSON format.');
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      setJsonInput(event.target.result);
    };
    reader.readAsText(file);
  };

  return (
    <div className="modal-overlay">
      <div className="modal-card" style={{ maxWidth: '540px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.15rem', color: 'var(--color-text-charcoal)', fontFamily: 'var(--font-heading)' }}>
            <Database size={20} color="var(--color-primary-green)" />
            Real URA Data Synchronization & Database Builder
          </h3>
          <X size={18} style={{ cursor: 'pointer', opacity: 0.7 }} onClick={onClose} />
        </div>

        <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', lineHeight: '1.4' }}>
          Build your persistent real-world Singapore property database (`property.db`). Ingest official government records directly via live URA API or by importing raw URA data exports.
        </p>

        {statusMessage && (
          <div style={{ background: 'rgba(0, 176, 128, 0.12)', border: '1px solid var(--color-accent-teal)', padding: '10px 14px', borderRadius: '8px', fontSize: '0.82rem', color: '#007A59', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <CheckCircle2 size={16} color="var(--color-accent-teal)" />
            {statusMessage}
          </div>
        )}

        {error && (
          <div style={{ background: 'rgba(203, 109, 81, 0.12)', border: '1px solid var(--color-primary-terracotta)', padding: '10px 14px', borderRadius: '8px', fontSize: '0.82rem', color: '#9E3F27', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertCircle size={16} color="var(--color-primary-terracotta)" />
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: '8px', margin: '8px 0' }}>
          <button
            type="button"
            className={`btn ${importMode === 'api' ? 'btn-primary' : ''}`}
            onClick={() => setImportMode('api')}
            style={{ flex: 1, fontSize: '0.82rem', justifyContent: 'center' }}
          >
            <Key size={14} /> Option 1: Live URA API Sync
          </button>
          <button
            type="button"
            className={`btn ${importMode === 'file' ? 'btn-primary' : ''}`}
            onClick={() => setImportMode('file')}
            style={{ flex: 1, fontSize: '0.82rem', justifyContent: 'center' }}
          >
            <Database size={14} /> Option 2: Import URA JSON Export
          </button>
        </div>

        {importMode === 'api' ? (
          <form onSubmit={handleLiveIngestion} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div className="filter-group">
              <label className="filter-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Key size={14} color="var(--color-accent-teal)" /> URA Access Key (Daily Token Service)
              </label>
              <input
                type="password"
                className="input-box"
                placeholder="Enter your private URA Access Key..."
                value={accessKey}
                onChange={e => setAccessKey(e.target.value)}
                disabled={loading}
              />
            </div>

            <div className="filter-group">
              <label className="filter-label">Admin Security Key (if required by server)</label>
              <input
                type="password"
                className="input-box"
                placeholder="X-Admin-Key (optional in local dev)..."
                value={adminKey}
                onChange={e => setAdminKey(e.target.value)}
                disabled={loading}
              />
            </div>

            <button type="submit" className="btn btn-primary" disabled={loading} style={{ justifyContent: 'center' }}>
              {loading ? <RefreshCw size={16} className="spin" /> : 'Fetch & Ingest Live Official URA Caveats'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleFileImport} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div className="filter-group">
              <label className="filter-label">Upload URA Export JSON File</label>
              <input
                type="file"
                accept=".json"
                onChange={handleFileUpload}
                className="input-box"
                style={{ paddingTop: '6px' }}
                disabled={loading}
              />
            </div>

            <div className="filter-group">
              <label className="filter-label">Or Paste Real URA JSON Dataset Payload</label>
              <textarea
                className="input-box"
                rows={4}
                placeholder="Paste URA API JSON result or array payload..."
                value={jsonInput}
                onChange={e => setJsonInput(e.target.value)}
                disabled={loading}
                style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}
              />
            </div>

            <button type="submit" className="btn btn-primary" disabled={loading} style={{ justifyContent: 'center' }}>
              {loading ? <RefreshCw size={16} className="spin" /> : 'Import Real URA Dataset into Database'}
            </button>
          </form>
        )}

        <div style={{ textAlign: 'right', marginTop: '12px' }}>
          <button className="btn" onClick={onClose} style={{ fontSize: '0.8rem' }}>Close</button>
        </div>
      </div>
    </div>
  );
}
