import AccessibleDialog from './AccessibleDialog';
import React from 'react';
import { X, Building, MapPin, Key, TrendingUp, Percent, Calendar } from 'lucide-react';
import LivabilityBadge from './LivabilityBadge';

export default function RentalYieldDrawer({ isOpen, onClose, project }) {
  if (!isOpen || !project) return null;

  const rentRate = project.medianRentPsft;
  const individualLease = project.yieldBasis === 'individual-rental';

  // Yield Tier Color & Label
  const yieldVal = project.grossYield;
  let yieldBadgeColor = '#94A3B8';
  let yieldLabel = 'N/A — Insufficient transactions';
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
      <AccessibleDialog label="Rental yield details" onClose={onClose} className="drawer-container" onClick={e => e.stopPropagation()} style={{ maxWidth: '540px' }}>
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
          <button aria-label="Close details" className="close-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        {/* Drawer Body */}
        <div className="drawer-body" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          {/* Key Metric Highlights */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div className="metric-card" style={{ background: '#FFFBEB', borderColor: '#FCD34D' }}>
              <div style={{ fontSize: '0.75rem', color: '#92400E', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Percent size={13} /> {individualLease ? 'Lease Gross Yield Estimate' : 'Project Gross Yield (Median Inputs)'}
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
                <Key size={13} /> {individualLease ? 'This Lease’s Monthly Rent' : 'Median Monthly Rent'}
              </div>
              <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--color-primary-green)', margin: '4px 0' }}>
                ${project.medianRent ? project.medianRent.toLocaleString() : '0'} <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>/mo</span>
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
                Rate: ${project.medianRentPsft ?? 'N/A'} /sqft/mo
              </div>
            </div>
          </div>

          {/* Transaction Price & Yield Formula Box */}
          <div style={{ background: '#F8FAFC', borderRadius: '10px', padding: '14px', border: '1px solid #E2E8F0' }}>
            <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '8px', color: 'var(--color-text-charcoal)' }}>
              Gross Rental Yield Computation
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', lineHeight: '1.6' }}>
              <div>Sale comparison: {project.saleBenchmark?.dateFrom} to {project.saleBenchmark?.dateTo} ({project.saleBenchmark?.saleCount || 0} usable sales). Rental sample: {project.usableRentalCount || 0} usable leases.</div>
              <strong>Gross Yield Formula:</strong><br />
              ({individualLease ? 'This lease’s monthly rent psf' : 'Median monthly rent psf'} × 12 / Median sale psf) × 100%<br />
              {project.grossYield != null && project.medianSalePsft ? (
                <>
                  = ({project.medianRentPsft} × 12 / {project.medianSalePsft}) × 100%<br />
                  = <span style={{ fontWeight: 800, color: yieldBadgeColor }}>{project.grossYield}%</span>
                </>
              ) : (
                <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                  At least three qualifying sales and three usable rentals are required.
                </span>
              )}
            </div>
          </div>

          {/* Livability Rating */}
          {project.livability && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#F8FAFC', padding: '12px 16px', borderRadius: '10px', border: '1px solid #E2E8F0' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.85rem' }}>Livability Rating</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Straight-line proximity to catalogued amenities</div>
              </div>
              <LivabilityBadge livability={project.livability} size="medium" />
            </div>
          )}

          {/* Additional Info Note */}
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', fontStyle: 'italic', background: '#FAFAFA', padding: '10px', borderRadius: '8px' }}>
            * Gross estimates exclude vacancy, maintenance, taxes and financing. Rental area-band midpoints are estimates. Sales match project, size, property type and tenure; sales have no bedroom field.
          </div>
        </div>
      </AccessibleDialog>
    </div>
  );
}
