import React, { useState } from 'react';
import { Sliders, Train, GraduationCap, Utensils, ShoppingBag, Trees, Check, RefreshCw } from 'lucide-react';

const PROFILES = [
  { id: 'balanced', label: 'Balanced', icon: '⚖️', weights: { mrt: 30, school: 25, hawker: 20, supermarket: 15, park: 10 } },
  { id: 'family', label: 'Family & Schools', icon: '👨‍👩‍👧', weights: { mrt: 20, school: 45, hawker: 15, supermarket: 10, park: 10 } },
  { id: 'commuter', label: 'Urban Commuter', icon: '🚆', weights: { mrt: 50, school: 10, hawker: 20, supermarket: 15, park: 5 } },
  { id: 'foodie', label: 'Foodie / Hawker', icon: '🍜', weights: { mrt: 20, school: 10, hawker: 50, supermarket: 15, park: 5 } },
  { id: 'nature', label: 'Nature & Wellness', icon: '🌳', weights: { mrt: 15, school: 15, hawker: 15, supermarket: 15, park: 40 } },
];

export default function LifestyleProfileSelector({ activeProfile, setActiveProfile, customWeights, setCustomWeights, onWeightsChange }) {
  const [showSliders, setShowSliders] = useState(false);

  const currentWeights = activeProfile === 'custom' ? customWeights : (PROFILES.find(p => p.id === activeProfile)?.weights || PROFILES[0].weights);

  const handleSelectProfile = (prof) => {
    setActiveProfile(prof.id);
    setShowSliders(false);
    if (onWeightsChange) {
      onWeightsChange(prof.weights);
    }
  };

  const handleSliderChange = (category, value) => {
    const newVal = parseInt(value, 10);
    const updated = { ...currentWeights, [category]: newVal };
    setCustomWeights(updated);
    setActiveProfile('custom');
    if (onWeightsChange) {
      onWeightsChange(updated);
    }
  };

  return (
    <div className="lifestyle-selector-container card" style={{ padding: '16px 20px', marginBottom: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '1.1rem' }}>🧭</span>
          <div>
            <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: 'var(--color-text-charcoal)' }}>
              Singapore Lifestyle & Amenity Profile
            </h4>
            <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
              Personalize amenity proximity weights to recalculate property scores
            </p>
          </div>
        </div>

        {/* Profile Preset Pills */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {PROFILES.map(prof => {
            const isActive = activeProfile === prof.id;
            return (
              <button
                key={prof.id}
                onClick={() => handleSelectProfile(prof)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 14px',
                  borderRadius: '20px',
                  border: isActive ? '2px solid var(--color-primary-green)' : '1px solid #E2E8F0',
                  background: isActive ? 'var(--color-primary-green)' : '#FFFFFF',
                  color: isActive ? '#FFFFFF' : 'var(--color-text-charcoal)',
                  fontWeight: isActive ? 700 : 500,
                  fontSize: '0.82rem',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  boxShadow: isActive ? '0 2px 8px rgba(16, 185, 129, 0.25)' : 'none'
                }}
              >
                <span>{prof.icon}</span>
                <span>{prof.label}</span>
                {isActive && <Check size={14} />}
              </button>
            );
          })}

          <button
            onClick={() => setShowSliders(!showSliders)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 14px',
              borderRadius: '20px',
              border: activeProfile === 'custom' || showSliders ? '2px solid var(--color-accent-teal)' : '1px dashed #CBD5E1',
              background: activeProfile === 'custom' || showSliders ? '#F0FDFA' : '#F8FAFC',
              color: activeProfile === 'custom' || showSliders ? 'var(--color-accent-teal)' : 'var(--color-text-muted)',
              fontWeight: 600,
              fontSize: '0.82rem',
              cursor: 'pointer'
            }}
          >
            <Sliders size={14} />
            <span>{activeProfile === 'custom' ? 'Custom Profile' : 'Adjust Sliders'}</span>
          </button>
        </div>
      </div>

      {/* Expandable Custom Weight Sliders */}
      {showSliders && (
        <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid #E2E8F0', background: '#F8FAFC', padding: '16px', borderRadius: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--color-text-charcoal)' }}>
              Custom Category Proximity Weights
            </span>
            <button
              onClick={() => handleSelectProfile(PROFILES[0])}
              style={{ background: 'none', border: 'none', color: 'var(--color-accent-teal)', fontSize: '0.78rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              <RefreshCw size={12} /> Reset to Default
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px' }}>
            {/* MRT */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', fontWeight: 600, marginBottom: '4px' }}>
                <span>🚆 MRT Stations</span>
                <span style={{ color: 'var(--color-primary-green)' }}>{currentWeights.mrt}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="80"
                step="5"
                value={currentWeights.mrt}
                onChange={(e) => handleSliderChange('mrt', e.target.value)}
                style={{ width: '100%', accentColor: 'var(--color-primary-green)' }}
              />
            </div>

            {/* Schools */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', fontWeight: 600, marginBottom: '4px' }}>
                <span>🏫 Primary Schools</span>
                <span style={{ color: 'var(--color-accent-teal)' }}>{currentWeights.school}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="80"
                step="5"
                value={currentWeights.school}
                onChange={(e) => handleSliderChange('school', e.target.value)}
                style={{ width: '100%', accentColor: 'var(--color-accent-teal)' }}
              />
            </div>

            {/* Hawkers */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', fontWeight: 600, marginBottom: '4px' }}>
                <span>🍜 Hawker Centres</span>
                <span style={{ color: 'var(--color-primary-terracotta)' }}>{currentWeights.hawker}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="80"
                step="5"
                value={currentWeights.hawker}
                onChange={(e) => handleSliderChange('hawker', e.target.value)}
                style={{ width: '100%', accentColor: 'var(--color-primary-terracotta)' }}
              />
            </div>

            {/* Supermarkets */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', fontWeight: 600, marginBottom: '4px' }}>
                <span>🛒 Supermarkets</span>
                <span style={{ color: '#D97706' }}>{currentWeights.supermarket}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="80"
                step="5"
                value={currentWeights.supermarket}
                onChange={(e) => handleSliderChange('supermarket', e.target.value)}
                style={{ width: '100%', accentColor: '#D97706' }}
              />
            </div>

            {/* Parks */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', fontWeight: 600, marginBottom: '4px' }}>
                <span>🌳 Parks & Greenery</span>
                <span style={{ color: '#059669' }}>{currentWeights.park}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="80"
                step="5"
                value={currentWeights.park}
                onChange={(e) => handleSliderChange('park', e.target.value)}
                style={{ width: '100%', accentColor: '#059669' }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
