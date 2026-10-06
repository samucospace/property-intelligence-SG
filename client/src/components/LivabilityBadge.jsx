import React, { useState, useRef } from 'react';
import ReactDOM from 'react-dom';
import { Train, GraduationCap, Utensils, ShoppingBag, Trees } from 'lucide-react';

export default function LivabilityBadge({ livability, onClick, size = 'medium' }) {
  const [isHovered, setIsHovered] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const textRef = useRef(null);

  if (!livability) return null;

  const { score, label = 'Location unavailable', color = '#94A3B8', subScores = {} } = livability;

  if (score === null || score === undefined) {
    const fontSz = size === 'large' ? '1.75rem' : size === 'small' ? '0.85rem' : '0.95rem';
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'baseline',
          fontWeight: 600,
          fontSize: fontSz,
          color: '#94A3B8',
          cursor: 'default'
        }}
        title="Location unavailable"
      >
        <span>N/A</span>
      </span>
    );
  }

  const handleMouseEnter = () => {
    if (textRef.current) {
      const rect = textRef.current.getBoundingClientRect();
      setCoords({
        top: rect.top - 8,
        left: rect.left + rect.width / 2
      });
    }
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
  };

  const categories = [
    { key: 'mrt', label: 'MRT Stations & Exits', icon: <Train size={12} color="#10B981" />, val: subScores.mrt || 0, color: '#10B981' },
    { key: 'school', label: 'Primary Schools (P1 Zone)', icon: <GraduationCap size={12} color="#0EA5E9" />, val: subScores.school || 0, color: '#0EA5E9' },
    { key: 'hawker', label: 'Hawker Centres & Food', icon: <Utensils size={12} color="#CB6D51" />, val: subScores.hawker || 0, color: '#CB6D51' },
    { key: 'supermarket', label: 'Supermarkets & Malls', icon: <ShoppingBag size={12} color="#D97706" />, val: subScores.supermarket || 0, color: '#D97706' },
    { key: 'park', label: 'Parks & Greenery', icon: <Trees size={12} color="#059669" />, val: subScores.park || 0, color: '#059669' },
  ];

  const fontSz = size === 'large' ? '1.75rem' : size === 'small' ? '0.85rem' : '0.95rem';

  return (
    <span
      ref={textRef}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={onClick ? `View amenity proximity details, score ${score}` : undefined}
      onKeyDown={event => { if(onClick && ["Enter"," "].includes(event.key)) {event.preventDefault();onClick();} }}
      onFocus={handleMouseEnter}
      onBlur={handleMouseLeave}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={(e) => {
        e.stopPropagation();
        if (onClick) onClick();
      }}
      style={{
        display: 'inline-flex',
        alignItems: 'baseline',
        gap: '4px',
        fontWeight: 700,
        fontSize: fontSz,
        color: color,
        cursor: 'pointer',
        transition: 'all 0.15s ease'
      }}
    >
      <span>{score}</span>
      {size === 'large' ? (
        <span style={{ fontSize: '1rem', color: 'var(--color-text-muted)', fontWeight: 400 }}> / 100</span>
      ) : size !== 'small' ? (
        <span style={{ opacity: 0.8, fontWeight: 500, fontSize: '0.8rem' }}>/ 100 • {label}</span>
      ) : null}

      {/* Render Portal Popover directly on document.body so it is NEVER clipped by parent containers */}
      {isHovered && ReactDOM.createPortal(
        <div
          style={{
            position: 'fixed',
            top: `${coords.top}px`,
            left: `${coords.left}px`,
            transform: 'translate(-50%, -100%)',
            width: '230px',
            background: '#FFFFFF',
            borderRadius: '12px',
            padding: '12px 14px',
            boxShadow: '0 12px 30px rgba(0, 0, 0, 0.22), 0 4px 12px rgba(0, 0, 0, 0.12)',
            border: '1px solid #CBD5E1',
            zIndex: 99999,
            pointerEvents: 'none',
            fontFamily: 'var(--font-body)',
            lineHeight: 1.3
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', paddingBottom: '6px', borderBottom: '1px solid #F1F5F9' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-text-charcoal)' }}>
              Category Breakdown
            </span>
            <span style={{ fontSize: '0.75rem', fontWeight: 800, color: color }}>
              {score}/100
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {categories.map((c) => (
              <div key={c.key}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.72rem', marginBottom: '2px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#334155', fontWeight: 600 }}>
                    {c.icon}
                    <span>{c.label}</span>
                  </div>
                  <span style={{ fontWeight: 700, color: c.color }}>{c.val}</span>
                </div>
                <div style={{ height: '4px', background: '#F1F5F9', borderRadius: '2px', overflow: 'hidden' }}>
                  <div style={{ width: `${c.val}%`, height: '100%', background: c.color, borderRadius: '2px' }} />
                </div>
              </div>
            ))}
          </div>

          {/* Arrow */}
          <div
            style={{
              position: 'absolute',
              top: '100%',
              left: '50%',
              transform: 'translateX(-50%)',
              width: 0,
              height: 0,
              borderLeft: '6px solid transparent',
              borderRight: '6px solid transparent',
              borderTop: '6px solid #FFFFFF'
            }}
          />
        </div>,
        document.body
      )}
    </span>
  );
}
