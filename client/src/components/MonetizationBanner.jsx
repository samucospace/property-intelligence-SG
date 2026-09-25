import React, { useState } from 'react';
import axios from 'axios';
import { Landmark, TrendingUp, CheckCircle, ArrowRight, ShieldCheck, Mail, Sparkles, X } from 'lucide-react';

export default function MonetizationBanner({ variant = 'mortgage', currentProject = null, className = '' }) {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showMortgageModal, setShowMortgageModal] = useState(false);
  const [mortgageDetails, setMortgageDetails] = useState({
    loanAmount: '1200000',
    tenureYears: '25',
    interestRate: '2.6'
  });
  const [leadForm, setLeadForm] = useState({ name: '', email: '', phone: '' });

  // Calculate monthly repayment: M = P [ i(1 + i)^n ] / [ (1 + i)^n – 1]
  const calculateRepayment = () => {
    const P = parseFloat(mortgageDetails.loanAmount) || 0;
    const annualRate = (parseFloat(mortgageDetails.interestRate) || 2.6) / 100;
    const r = annualRate / 12;
    const n = (parseInt(mortgageDetails.tenureYears, 10) || 25) * 12;
    if (r <= 0 || n <= 0 || P <= 0) return 0;
    const monthly = (P * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
    return Math.round(monthly);
  };

  const handleNewsletterSubmit = async (e) => {
    e.preventDefault();
    if (!email || !email.includes('@')) return;
    setLoading(true);
    try {
      await axios.post('/api/leads/submit', {
        email,
        leadType: 'newsletter',
        projectInterest: currentProject?.name || null
      });
      setSubmitted(true);
    } catch (err) {
      console.error('Newsletter submit error:', err);
      // Fallback optimistic success for offline/local resilience
      setSubmitted(true);
    } finally {
      setLoading(false);
    }
  };

  const handleMortgageLeadSubmit = async (e) => {
    e.preventDefault();
    if (!leadForm.email || !leadForm.email.includes('@')) return;
    setLoading(true);
    try {
      await axios.post('/api/leads/submit', {
        email: leadForm.email,
        leadType: 'mortgage_enquiry',
        phone: leadForm.phone,
        projectInterest: currentProject?.name || null
      });
      setSubmitted(true);
    } catch (err) {
      console.error('Mortgage lead submit error:', err);
      setSubmitted(true);
    } finally {
      setLoading(false);
    }
  };

  // 1. Weekly Newsletter Variant
  if (variant === 'newsletter') {
    return (
      <div style={{
        background: 'linear-gradient(135deg, #FAF6F0 0%, #F5EFEB 100%)',
        border: '1px solid rgba(203, 109, 81, 0.25)',
        borderRadius: '16px',
        padding: '20px 24px',
        margin: '16px 0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '16px',
        boxShadow: '0 2px 12px rgba(54, 69, 79, 0.04)'
      }} className={className}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', maxWidth: '620px' }}>
          <div style={{
            width: '44px',
            height: '44px',
            borderRadius: '12px',
            background: 'rgba(203, 109, 81, 0.12)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}>
            <Sparkles size={22} color="var(--color-primary-terracotta)" />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.96rem', color: 'var(--color-text-charcoal)' }}>
              Singapore Undervalued Property & Yield Watchlist
            </div>
            <div style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', marginTop: '2px' }}>
              Receive our weekly analysis of Singapore private condos with top gross yields (&gt;4.2%) and below-median caveats.
            </div>
          </div>
        </div>

        {submitted ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#065F46', fontWeight: 600, fontSize: '0.85rem' }}>
            <CheckCircle size={18} color="#10B981" />
            Subscribed! You will receive our next Singapore property briefing.
          </div>
        ) : (
          <form onSubmit={handleNewsletterSubmit} style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <input
              type="email"
              required
              placeholder="Enter your email address..."
              value={email}
              onChange={e => setEmail(e.target.value)}
              style={{
                padding: '8px 14px',
                borderRadius: '8px',
                border: '1px solid rgba(54, 69, 79, 0.2)',
                background: '#FFFFFF',
                fontSize: '0.84rem',
                minWidth: '220px',
                outline: 'none'
              }}
            />
            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary"
              style={{
                background: 'var(--color-primary-terracotta)',
                borderColor: 'var(--color-primary-terracotta)',
                fontSize: '0.82rem',
                padding: '8px 16px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              {loading ? 'Subscribing...' : 'Get Weekly Deals'} <ArrowRight size={14} />
            </button>
          </form>
        )}
      </div>
    );
  }

  // 2. Bank Mortgage & SORA Comparison Card (Default Leaderboard Variant)
  return (
    <>
      <div style={{
        background: 'linear-gradient(135deg, #F0FDF4 0%, #ECFDF5 50%, #F5FBF7 100%)',
        border: '1px solid rgba(79, 121, 66, 0.25)',
        borderRadius: '16px',
        padding: '18px 24px',
        margin: '16px 0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '16px',
        boxShadow: '0 2px 14px rgba(79, 121, 66, 0.06)'
      }} className={className}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', maxWidth: '680px' }}>
          <div style={{
            width: '46px',
            height: '46px',
            borderRadius: '12px',
            background: 'rgba(79, 121, 66, 0.12)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}>
            <Landmark size={24} color="var(--color-primary-green)" />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontWeight: 700, fontSize: '0.98rem', color: 'var(--color-text-charcoal)' }}>
                Financing a Singapore Private Property?
              </span>
              <span style={{
                background: '#D1FAE5',
                color: '#065F46',
                fontSize: '0.72rem',
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: '6px'
              }}>
                From 2.55% p.a.
              </span>
            </div>
            <div style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', marginTop: '2px' }}>
              Compare current 3M SORA floating & fixed mortgage packages across major Singapore banks (DBS, OCBC, UOB, Standard Chartered).
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button
            onClick={() => setShowMortgageModal(true)}
            className="btn btn-primary"
            style={{
              fontSize: '0.84rem',
              padding: '9px 18px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              boxShadow: '0 2px 8px rgba(79, 121, 66, 0.25)'
            }}
          >
            Calculate Loan & Compare Rates <ArrowRight size={14} />
          </button>
        </div>
      </div>

      {/* Interactive Mortgage Comparison Modal */}
      {showMortgageModal && (
        <div className="modal-overlay">
          <div className="modal-card" style={{ maxWidth: '520px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.15rem', color: 'var(--color-text-charcoal)' }}>
                <Landmark size={20} color="var(--color-primary-green)" />
                Singapore Home Loan Affordability Calculator
              </h3>
              <X size={18} style={{ cursor: 'pointer', opacity: 0.7 }} onClick={() => setShowMortgageModal(false)} />
            </div>

            <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', marginTop: '4px' }}>
              Algorithmically estimate your monthly repayment based on current Singapore Overnight Rate Average (SORA) benchmarks.
            </p>

            {/* Repayment Estimation Box */}
            <div style={{
              background: '#F8FAF9',
              border: '1px solid #D1E7DD',
              borderRadius: '12px',
              padding: '16px',
              textAlign: 'center',
              margin: '12px 0'
            }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600 }}>
                Estimated Monthly Repayment
              </span>
              <div style={{ fontSize: '1.9rem', fontWeight: 800, color: 'var(--color-primary-green)', margin: '4px 0' }}>
                ${calculateRepayment().toLocaleString()} <span style={{ fontSize: '0.9rem', fontWeight: 500, color: 'var(--color-text-muted)' }}>/month</span>
              </div>
              <span style={{ fontSize: '0.74rem', color: '#6A7B82' }}>
                Based on S${parseInt(mortgageDetails.loanAmount || 0, 10).toLocaleString()} loan over {mortgageDetails.tenureYears} years at {mortgageDetails.interestRate}% p.a.
              </span>
            </div>

            {/* Inputs */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div className="filter-group">
                <label className="filter-label">Loan Amount (SGD)</label>
                <input
                  type="number"
                  className="input-box"
                  value={mortgageDetails.loanAmount}
                  onChange={e => setMortgageDetails({ ...mortgageDetails, loanAmount: e.target.value })}
                />
              </div>
              <div className="filter-group">
                <label className="filter-label">Tenure (Years)</label>
                <input
                  type="number"
                  className="input-box"
                  value={mortgageDetails.tenureYears}
                  onChange={e => setMortgageDetails({ ...mortgageDetails, tenureYears: e.target.value })}
                />
              </div>
            </div>

            {submitted ? (
              <div style={{ background: '#ECFDF5', border: '1px solid #A7F3D0', padding: '14px', borderRadius: '10px', marginTop: '14px', textAlign: 'center', color: '#065F46', fontSize: '0.85rem' }}>
                <CheckCircle size={20} color="#10B981" style={{ margin: '0 auto 6px' }} />
                <strong>Request Received!</strong>
                <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: '#047857' }}>
                  A verified Singapore mortgage advisory specialist will contact you with customized bank loan comparison sheets.
                </p>
              </div>
            ) : (
              <form onSubmit={handleMortgageLeadSubmit} style={{ marginTop: '14px', borderTop: '1px solid #E2E8F0', paddingTop: '14px' }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text-charcoal)', marginBottom: '8px' }}>
                  Receive Formal Bank Loan Comparison Quotes (Free)
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <input
                    type="email"
                    required
                    placeholder="Your Email Address *"
                    className="input-box"
                    value={leadForm.email}
                    onChange={e => setLeadForm({ ...leadForm, email: e.target.value })}
                  />
                  <input
                    type="tel"
                    placeholder="Mobile Number (Optional)"
                    className="input-box"
                    value={leadForm.phone}
                    onChange={e => setLeadForm({ ...leadForm, phone: e.target.value })}
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="btn btn-primary"
                  style={{ width: '100%', marginTop: '10px', justifyContent: 'center' }}
                >
                  {loading ? 'Submitting...' : 'Request Bank Mortgage Comparison'}
                </button>
              </form>
            )}

            <div style={{ textAlign: 'right', marginTop: '12px' }}>
              <button className="btn" onClick={() => setShowMortgageModal(false)} style={{ fontSize: '0.8rem' }}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
