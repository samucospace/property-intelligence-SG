import AccessibleDialog from './AccessibleDialog';
import React from 'react';
import { X, Compass, Train, GraduationCap, Utensils, ShoppingBag, Trees, MapPin, Footprints, ShieldCheck } from 'lucide-react';

export default function LivabilityDrawer({ projectData, isOpen, onClose }) {
  if (!isOpen || !projectData) return null;

  const { project, livability } = projectData;
  if (!livability) return null;

  const { score = null, label = 'Moderate amenity proximity', color = '#D97706', subScores = {}, nearest = {} } = livability;

  return (
    <div className="drawer-overlay" onClick={onClose} style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(15, 23, 42, 0.5)',
      backdropFilter: 'blur(4px)',
      zIndex: 1000,
      display: 'flex',
      justifyContent: 'flex-end',
      animation: 'fadeIn 0.2s ease-out'
    }}>
      <AccessibleDialog label="Amenity proximity details" onClose={onClose}
        className="drawer-content"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: '460px',
          height: '100%',
          background: '#FFFFFF',
          boxShadow: '-4px 0 24px rgba(0, 0, 0, 0.15)',
          display: 'flex',
          flexDirection: 'column',
          overflowY: 'auto'
        }}
      >
        {/* Header */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', background: '#F8FAFC' }}>
          <div>
            <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-primary-green)', fontWeight: 700 }}>
              Amenity Proximity Breakdown
            </span>
            <h2 style={{ margin: '4px 0 2px 0', fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-text-charcoal)' }}>
              {project?.name || 'Property Development'}
            </h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
              <MapPin size={14} />
              <span>{project?.street}, District {project?.district} ({project?.planningArea || 'Singapore'})</span>
            </div>
          </div>

          <button
            aria-label="Close details"
            onClick={onClose}
            style={{
              background: '#F1F5F9',
              border: 'none',
              borderRadius: '50%',
              width: '32px',
              height: '32px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: '#64748B'
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Main Score Hero Card */}
        <div style={{ padding: '24px', textAlign: 'center', background: `linear-gradient(135deg, ${color}10 0%, ${color}25 100%)`, borderBottom: '1px solid #E2E8F0' }}>
          <div style={{
            display: 'inline-flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100px',
            height: '100px',
            borderRadius: '50%',
            border: `4px solid ${color}`,
            background: '#FFFFFF',
            boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
            margin: '0 auto 12px auto'
          }}>
            <span style={{ fontSize: '2.2rem', fontWeight: 800, color: color, lineHeight: 1 }}>{score ?? 'N/A'}</span>
            <span style={{ fontSize: '0.7rem', color: '#64748B', fontWeight: 600 }}>OUT OF 100</span>
          </div>

          <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, color: 'var(--color-text-charcoal)' }}>
            {label}
          </h3>
          <p style={{ margin: '4px 0 0 0', fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
            Straight-line distances from an incomplete curated catalog. These are not walking routes or school admission eligibility measurements.
          </p>
        </div>

        <p style={{padding: '0 24px'}}>Catalog: {livability.provenance?.catalogCount ?? 'unknown'} POIs, including {livability.provenance?.schoolCount ?? 'unknown'} schools. Coverage is incomplete.</p>
        {/* Category Breakdown Progress Bars */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #E2E8F0' }}>
          <h4 style={{ margin: '0 0 14px 0', fontSize: '0.9rem', fontWeight: 700, color: 'var(--color-text-charcoal)' }}>
            Category Proximity Estimates
          </h4>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {/* MRT */}
            <CategoryScoreBar
              icon={<Train size={16} color="var(--color-primary-green)" />}
              title="MRT Stations & Exits"
              score={subScores.mrt || 0}
              weight="30%"
              color="var(--color-primary-green)"
            />

            {/* School */}
            <CategoryScoreBar
              icon={<GraduationCap size={16} color="var(--color-accent-teal)" />}
              title="Catalogued primary schools"
              score={subScores.school || 0}
              weight="25%"
              color="var(--color-accent-teal)"
            />

            {/* Hawker */}
            <CategoryScoreBar
              icon={<Utensils size={16} color="var(--color-primary-terracotta)" />}
              title="Hawker Centres & Food"
              score={subScores.hawker || 0}
              weight="20%"
              color="var(--color-primary-terracotta)"
            />

            {/* Supermarket */}
            <CategoryScoreBar
              icon={<ShoppingBag size={16} color="#D97706" />}
              title="Supermarkets & Malls"
              score={subScores.supermarket || 0}
              weight="15%"
              color="#D97706"
            />

            {/* Park */}
            <CategoryScoreBar
              icon={<Trees size={16} color="#059669" />}
              title="Parks & Green Spaces"
              score={subScores.park || 0}
              weight="10%"
              color="#059669"
            />
          </div>
        </div>

        {/* Nearest Amenities Breakdown */}
        <div style={{ padding: '20px 24px', flex: 1 }}>
          <h4 style={{ margin: '0 0 16px 0', fontSize: '0.9rem', fontWeight: 700, color: 'var(--color-text-charcoal)' }}>
            Nearby Singapore Amenities Detail
          </h4>

          {/* 🚆 MRT */}
          <AmenityGroupSection
            icon={<Train size={16} color="var(--color-primary-green)" />}
            title="Nearest MRT Stations"
            items={nearest.mrt}
          />

          {/* 🏫 Schools */}
          <AmenityGroupSection
            icon={<GraduationCap size={16} color="var(--color-accent-teal)" />}
            title="Nearby catalogued primary schools"
            items={nearest.school}
            badgeTag={(item) => (
              <span style={{
                fontSize: '0.7rem',
                padding: '2px 6px',
                borderRadius: '4px',
                fontWeight: 600,
                background: item.distMeters <= 1000 ? '#ECFDF5' : '#FFFBEB',
                color: item.distMeters <= 1000 ? '#059669' : '#D97706',
                border: `1px solid ${item.distMeters <= 1000 ? '#10B981' : '#F59E0B'}`
              }}>
                {item.distMeters <= 1000 ? 'Within 1km straight-line' : '1km–2km straight-line'}
              </span>
            )}
          />

          {/* 🍜 Hawkers */}
          <AmenityGroupSection
            icon={<Utensils size={16} color="var(--color-primary-terracotta)" />}
            title="Nearest Hawker Centres"
            items={nearest.hawker}
          />

          {/* 🛒 Supermarkets */}
          <AmenityGroupSection
            icon={<ShoppingBag size={16} color="#D97706" />}
            title="Nearest Supermarkets & Shopping Malls"
            items={nearest.supermarket}
          />

          {/* 🌳 Parks */}
          <AmenityGroupSection
            icon={<Trees size={16} color="#059669" />}
            title="Nearest Parks & Nature Spaces"
            items={nearest.park}
          />
        </div>
      </AccessibleDialog>
    </div>
  );
}

function CategoryScoreBar({ icon, title, score, weight, color }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem', marginBottom: '4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, color: 'var(--color-text-charcoal)' }}>
          {icon}
          <span>{title}</span>
        </div>
        <div>
          <span style={{ fontWeight: 700, color: color }}>{score}</span>
          <span style={{ color: '#94A3B8', fontSize: '0.75rem', marginLeft: '4px' }}>({weight} weight)</span>
        </div>
      </div>
      <div style={{ height: '6px', background: '#F1F5F9', borderRadius: '3px', overflow: 'hidden' }}>
        <div style={{ width: `${score}%`, height: '100%', background: color, borderRadius: '3px', transition: 'width 0.3s ease' }} />
      </div>
    </div>
  );
}

function AmenityGroupSection({ icon, title, items = [], badgeTag }) {
  if (!items || items.length === 0) return null;

  return (
    <div style={{ marginBottom: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', fontWeight: 700, color: 'var(--color-text-charcoal)', marginBottom: '8px' }}>
        {icon}
        <span>{title}</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {items.map((item, idx) => (
          <div
            key={idx}
            style={{
              padding: '8px 12px',
              borderRadius: '8px',
              background: '#F8FAFC',
              border: '1px solid #F1F5F9',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}
          >
            <div>
              <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--color-text-charcoal)' }}>
                {item.name}
              </div>
              {badgeTag && badgeTag(item)}
            </div>

            <div style={{ textAlign: 'right', fontSize: '0.78rem' }}>
              <div style={{ fontWeight: 700, color: 'var(--color-primary-green)', display: 'flex', alignItems: 'center', gap: '3px', justifyContent: 'flex-end' }}>
                <Footprints size={12} />
                <span>{item.distMeters}m</span>
              </div>
              <div style={{ color: '#64748B' }}>
                ~{item.walkTimeMins} min estimate (80m/min)
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
