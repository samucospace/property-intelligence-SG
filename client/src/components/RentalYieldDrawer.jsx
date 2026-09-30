import React from 'react';
import { X, Building, MapPin, Key, TrendingUp, Percent, Calendar } from 'lucide-react';
import LivabilityBadge from './LivabilityBadge';

export default function RentalYieldDrawer({ isOpen, onClose, project }) {
  if (!isOpen || !project) return null;

  const rentRate = project.medianRentPsft;

  // Yield Tier Color & Label
  const yieldVal = project.grossYield;
  let yieldBadgeColor = '#94A3B8';
  let yieldLabel = 'N/A — no recent sales';
  if (yieldVal != null) {
    if (yieldVal >= 4.25) {
      yieldBadgeColor = '#10B981';
      yieldLabel = 'High Cashflow Yield (≥ 4.25%)';
    } else if (yieldVal >= 3.25) {
      yieldBadgeColor = '#D97706';
      yieldLabel = 'Moderate Balanced Yield (3.25% - 4.25%)';
    } else {
      yieldBadgeColor = '#CB6D51';
      yieldLabel = 'Low / Trophy Yield (< 3.25%)';
    }
  }

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer-container" onClick={e => e.stopPropagation()} style={{ maxWidth: '540px' }}>
        {/* Header */}
        <div className="drawer-header" style={{ borderBottom: '1px solid #E2E8F0', paddingBottom: '14px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
              <Building size={20} color="var(--color-primary-terracotta)" />
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>{project.name}</h2>
            </div>
            <div style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <MapPin size={13} /> {project.street} • District {project.district} ({project.segment})
            </div>
          </div>
          <button className="close-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        {/* Drawer Body */}
        <div className="drawer-body" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          {/* Key Metric Highlights */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div className="metric-card" style={{ background: '#FFFBEB', borderColor: '#FCD34D' }}>
              <div style={{ fontSize: '0.75rem', color: '#92400E', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Percent size={13} /> Estimated Gross Yield
              </div>
              <div style={{ fontSize: '1.6rem', fontWeight: 800, color: yieldBadgeColor, margin: '4px 0' }}>
                {project.grossYield ? `${project.grossYield}%` : 'N/A'}
              </div>
              <div style={{ fontSize: '0.72rem', color: yieldBadgeColor, fontWeight: 600 }}>
                {yieldLabel}
              </div>
            </div>

            <div className="metric-card" style={{ background: '#F0FDF4', borderColor: '#86EFAC' }}>
              <div style={{ fontSize: '0.75rem', color: '#166534', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Key size={13} /> Median Monthly Rent
              </div>
              <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--color-primary-green)', margin: '4px 0' }}>
                ${project.medianRent ? project.medianRent.toLocaleString() : '0'} <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>/mo</span>
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
                Rate: ${project.medianRentPsft ? project.medianRentPsft : '0'} /sqft/mo
              </div>
            </div>
          </div>

          {/* Transaction Price & Yield Formula Box */}
          <div style={{ background: '#F8FAFC', borderRadius: '10px', padding: '14px', border: '1px solid #E2E8F0' }}>
            <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '8px', color: 'var(--color-text-charcoal)' }}>
              Gross Rental Yield Computation
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', lineHeight: '1.6' }}>
              <strong>Gross Yield Formula:</strong><br />
              (Annual Rent / Purchase Transaction Price) × 100%<br />
              {project.medianSaleValuation ? (
                <>
                  = (${(project.medianRent * 12 || 0).toLocaleString()} / ${project.medianSaleValuation.toLocaleString()}) × 100%<br />
                  = <span style={{ fontWeight: 800, color: yieldBadgeColor }}>{project.grossYield}%</span>
                </>
              ) : (
                <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                  No qualifying recent sale transactions available to compute gross yield.
                </span>
              )}
            </div>
          </div>

          {/* Livability Rating */}
          {project.livability && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#F8FAFC', padding: '12px 16px', borderRadius: '10px', border: '1px solid #E2E8F0' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.85rem' }}>Livability Rating</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Walkability to Transit, Hawkers & Parks</div>
              </div>
              <LivabilityBadge livability={project.livability} size="medium" />
            </div>
          )}

          {/* Additional Info Note */}
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', fontStyle: 'italic', background: '#FAFAFA', padding: '10px', borderRadius: '8px' }}>
            * Rental yields are gross yields based on median monthly rental contract values relative to median caveat sale prices recorded across all transaction tiers.
          </div>
        </div>
      </div>
    </div>
  );
}
