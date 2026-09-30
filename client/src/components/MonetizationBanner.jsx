import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { UserCheck, ShieldCheck, CheckCircle, ArrowRight, Mail, Sparkles, X, Building, Phone, Send, AlertCircle } from 'lucide-react';

export default function MonetizationBanner({
  variant = 'agent',
  currentProject = null,
  className = '',
  isEnquiryModalOpen,
  onToggleEnquiryModal
}) {
  const [email, setEmail] = useState('');
  const [newsletterConsent, setNewsletterConsent] = useState(false);
  const [newsletterHoneypot, setNewsletterHoneypot] = useState('');
  const [newsletterSuccess, setNewsletterSuccess] = useState(false);
  const [newsletterError, setNewsletterError] = useState(null);
  const [newsletterLoading, setNewsletterLoading] = useState(false);

  // Internal modal state if not controlled externally
  const [internalShowModal, setInternalShowModal] = useState(false);
  const showModal = isEnquiryModalOpen !== undefined ? isEnquiryModalOpen : internalShowModal;
  const setShowModal = onToggleEnquiryModal || setInternalShowModal;

  const [agentSubmitted, setAgentSubmitted] = useState(false);
  const [agentError, setAgentError] = useState(null);
  const [agentLoading, setAgentLoading] = useState(false);

  // Agent enquiry form state - PDPA consent unchecked by default (Step 4.4.1)
  const [enquiryForm, setEnquiryForm] = useState({
    name: '',
    email: '',
    phone: '',
    enquiryType: 'Buying a Unit',
    projectInterest: currentProject?.name || '',
    notes: '',
    pdpaConsent: false,
    website: '' // Honeypot field (Step 4.5.1)
  });

  useEffect(() => {
    if (currentProject?.name) {
      setEnquiryForm(prev => ({ ...prev, projectInterest: currentProject.name }));
    }
  }, [currentProject]);

  const handleNewsletterSubmit = async (e) => {
    e.preventDefault();
    setNewsletterError(null);

    if (!email || !email.includes('@')) {
      setNewsletterError('Please enter a valid email address.');
      return;
    }

    if (!newsletterConsent) {
      setNewsletterError('Please tick the consent checkbox to subscribe.');
      return;
    }

    setNewsletterLoading(true);
    try {
      const res = await axios.post('/api/leads/submit', {
        email: email.trim().toLowerCase(),
        leadType: 'newsletter',
        projectInterest: currentProject?.name || null,
        pdpaConsent: true,
        website: newsletterHoneypot
      });
      setNewsletterSuccess(res.data?.message || 'Subscribed! Please check your inbox.');
    } catch (err) {
      console.error('Newsletter submit error:', err);
      const errMsg = err.response?.data?.error || 'Unable to subscribe. Please try again.';
      setNewsletterError(errMsg);
    } finally {
      setNewsletterLoading(false);
    }
  };

  const handleAgentEnquirySubmit = async (e) => {
    e.preventDefault();
    setAgentError(null);

    if (!enquiryForm.email || !enquiryForm.email.includes('@')) {
      setAgentError('Please enter a valid email address.');
      return;
    }

    const cleanPhone = enquiryForm.phone.replace(/\s+/g, '');
    const sgPhoneRegex = /^(?:\+65)?[689]\d{7}$/;
    if (!sgPhoneRegex.test(cleanPhone)) {
      setAgentError('Please enter an 8-digit Singapore phone number starting with 6, 8, or 9.');
      return;
    }

    if (!enquiryForm.pdpaConsent) {
      setAgentError('Please tick the Singapore PDPA consent box to proceed.');
      return;
    }

    setAgentLoading(true);
    try {
      await axios.post('/api/leads/submit', {
        name: enquiryForm.name,
        email: enquiryForm.email,
        phone: enquiryForm.phone,
        leadType: 'agent_advisory',
        enquiryType: enquiryForm.enquiryType,
        projectInterest: enquiryForm.projectInterest || currentProject?.name || 'General Inquiry',
        details: enquiryForm.notes,
        pdpaConsent: enquiryForm.pdpaConsent,
        website: enquiryForm.website
      });
      setAgentSubmitted(true);
    } catch (err) {
      console.error('Agent enquiry submit error:', err);
      const errMsg = err.response?.data?.error || 'Unable to submit enquiry. Please check your details and try again.';
      setAgentError(errMsg);
    } finally {
      setAgentLoading(false);
    }
  };

  // 1. Weekly Newsletter Variant (With Explicit PDPA Disclosure)
  if (variant === 'newsletter') {
    return (
      <div style={{
        background: 'linear-gradient(135deg, #FAF6F0 0%, #F5EFEB 100%)',
        border: '1px solid rgba(203, 109, 81, 0.25)',
        borderRadius: '16px',
        padding: '22px 24px',
        margin: '16px 0',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        boxShadow: '0 2px 12px rgba(54, 69, 79, 0.04)'
      }} className={className}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
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
              <div style={{ fontWeight: 700, fontSize: '0.98rem', color: 'var(--color-text-charcoal)' }}>
                Singapore Property Yield & Undervalued Caveats Watchlist
              </div>
              <div style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', marginTop: '2px' }}>
                Join investors receiving weekly analytical digests on private condos with top gross rental yields (&gt;4.2%) and below-market transaction prices.
              </div>
            </div>
          </div>

          {newsletterSuccess ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#065F46', fontWeight: 600, fontSize: '0.86rem' }}>
              <CheckCircle size={18} color="#10B981" />
              {newsletterSuccess}
            </div>
          ) : (
            <form onSubmit={handleNewsletterSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {/* Invisible Honeypot field for bot protection */}
              <input
                type="text"
                name="website"
                value={newsletterHoneypot}
                onChange={e => setNewsletterHoneypot(e.target.value)}
                style={{ display: 'none' }}
                tabIndex="-1"
                autoComplete="off"
              />

              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <input
                  type="email"
                  required
                  placeholder="Enter your email address..."
                  value={email}
                  onChange={e => { setEmail(e.target.value); setNewsletterError(null); }}
                  style={{
                    padding: '9px 14px',
                    borderRadius: '8px',
                    border: '1px solid rgba(54, 69, 79, 0.2)',
                    background: '#FFFFFF',
                    fontSize: '0.84rem',
                    minWidth: '240px',
                    outline: 'none'
                  }}
                />
                <button
                  type="submit"
                  disabled={newsletterLoading}
                  className="btn btn-primary"
                  style={{
                    background: 'var(--color-primary-terracotta)',
                    borderColor: 'var(--color-primary-terracotta)',
                    fontSize: '0.84rem',
                    padding: '9px 18px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  {newsletterLoading ? 'Subscribing...' : 'Get Weekly Deals'} <ArrowRight size={14} />
                </button>
              </div>

              {/* Explicit Newsletter Opt-In Consent Checkbox (Step 4.4.2) */}
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.74rem', color: '#475569', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  required
                  checked={newsletterConsent}
                  onChange={e => { setNewsletterConsent(e.target.checked); setNewsletterError(null); }}
                  style={{ accentColor: 'var(--color-primary-terracotta)' }}
                />
                <span>I consent to receive weekly property market analysis and yield digests.</span>
              </label>

              {newsletterError && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#DC2626', fontSize: '0.75rem', fontWeight: 600 }}>
                  <AlertCircle size={13} /> {newsletterError}
                </div>
              )}
            </form>
          )}
        </div>

        {/* PDPA Compliance Micro-notice */}
        <div style={{ fontSize: '0.72rem', color: '#8898AA', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <ShieldCheck size={13} color="var(--color-primary-green)" />
          <span>
            <strong>Singapore PDPA Protected:</strong> Your email is processed under the Personal Data Protection Act 2012. We do not sell personal data. Unsubscribe anytime with 1 click.
          </span>
        </div>
      </div>
    );
  }

  // 2. Verified CEA District Specialist Advisory Card (Default / Agent Variant)
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
            <UserCheck size={24} color="var(--color-primary-green)" />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700, fontSize: '0.98rem', color: 'var(--color-text-charcoal)' }}>
                Thinking of Buying, Selling, or Leasing in this Area?
              </span>
            </div>
            <div style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', marginTop: '2px' }}>
              Connect with an accredited CEA specialist for no-obligation on-the-ground transaction caveats and advisory.
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button
            onClick={() => setShowModal(true)}
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
            Connect with an Agent <ArrowRight size={14} />
          </button>
        </div>
      </div>

      {/* Verified CEA Specialist Lead Modal */}
      {showModal && (
        <div className="modal-overlay">
          <div className="modal-card" style={{ maxWidth: '520px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.15rem', color: 'var(--color-text-charcoal)' }}>
                <UserCheck size={20} color="var(--color-primary-green)" />
                Connect with an Accredited CEA Agent
              </h3>
              <X size={18} style={{ cursor: 'pointer', opacity: 0.7 }} onClick={() => setShowModal(false)} />
            </div>

            <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', marginTop: '4px', lineHeight: '1.4' }}>
              Our appointed real estate partner holds an official licence registered with the <strong>Council for Estate Agencies (CEA)</strong> under the Estate Agents Act of Singapore (ERA Realty Network Pte Ltd / Lic: L3002382K).
            </p>

            {agentSubmitted ? (
              <div style={{ background: '#ECFDF5', border: '1px solid #A7F3D0', padding: '18px', borderRadius: '12px', marginTop: '16px', textAlign: 'center', color: '#065F46' }}>
                <CheckCircle size={28} color="#10B981" style={{ margin: '0 auto 8px' }} />
                <div style={{ fontWeight: 700, fontSize: '1rem' }}>Enquiry Received!</div>
                <p style={{ margin: '6px 0 0', fontSize: '0.82rem', color: '#047857', lineHeight: '1.5' }}>
                  Our CEA-registered district specialist will review your request and connect with you via WhatsApp or Email with customized transaction price and market insights.
                </p>
                <button
                  className="btn btn-primary"
                  onClick={() => { setShowModal(false); setAgentSubmitted(false); }}
                  style={{ marginTop: '14px', fontSize: '0.82rem' }}
                >
                  Done
                </button>
              </div>
            ) : (
              <form onSubmit={handleAgentEnquirySubmit} style={{ marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {/* Honeypot field for bot protection */}
                <input
                  type="text"
                  name="website"
                  value={enquiryForm.website}
                  onChange={e => setEnquiryForm({ ...enquiryForm, website: e.target.value })}
                  style={{ display: 'none' }}
                  tabIndex="-1"
                  autoComplete="off"
                />

                {agentError && (
                  <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#B91C1C', padding: '8px 12px', borderRadius: '6px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <AlertCircle size={15} /> {agentError}
                  </div>
                )}

                {/* Enquiry Type Selector */}
                <div className="filter-group">
                  <label className="filter-label">I am looking to:</label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
                    {['Buy', 'Sell', 'Rent Out', 'Advisory'].map(type => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => setEnquiryForm({ ...enquiryForm, enquiryType: type })}
                        style={{
                          padding: '7px 4px',
                          borderRadius: '8px',
                          border: enquiryForm.enquiryType === type ? '2px solid var(--color-primary-green)' : '1px solid var(--color-border-subtle)',
                          background: enquiryForm.enquiryType === type ? '#ECFDF5' : '#FFFFFF',
                          color: enquiryForm.enquiryType === type ? 'var(--color-primary-green)' : 'var(--color-text-charcoal)',
                          fontWeight: enquiryForm.enquiryType === type ? 700 : 500,
                          fontSize: '0.78rem',
                          cursor: 'pointer'
                        }}
                      >
                        {type}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Name & Contact */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <div className="filter-group">
                    <label className="filter-label">Your Name *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Alex Tan"
                      className="input-box"
                      value={enquiryForm.name}
                      onChange={e => setEnquiryForm({ ...enquiryForm, name: e.target.value })}
                    />
                  </div>
                  <div className="filter-group">
                    <label className="filter-label">WhatsApp / Phone *</label>
                    <input
                      type="tel"
                      required
                      placeholder="+65 9123 4567"
                      className="input-box"
                      value={enquiryForm.phone}
                      onChange={e => setEnquiryForm({ ...enquiryForm, phone: e.target.value })}
                    />
                  </div>
                </div>

                <div className="filter-group">
                  <label className="filter-label">Email Address *</label>
                  <input
                    type="email"
                    required
                    placeholder="name@example.com"
                    className="input-box"
                    value={enquiryForm.email}
                    onChange={e => setEnquiryForm({ ...enquiryForm, email: e.target.value })}
                  />
                </div>

                <div className="filter-group">
                  <label className="filter-label">Development of Interest / Notes</label>
                  <input
                    type="text"
                    placeholder="e.g. Reflections at Keppel Bay, 2-bedder high floor..."
                    className="input-box"
                    value={enquiryForm.projectInterest}
                    onChange={e => setEnquiryForm({ ...enquiryForm, projectInterest: e.target.value })}
                  />
                </div>

                {/* Mandatory PDPA Consent Checkbox - Unticked by default (Step 4.4.1) */}
                <div style={{
                  background: '#F8FAF9',
                  border: '1px solid #D1E7DD',
                  borderRadius: '8px',
                  padding: '10px 12px',
                  fontSize: '0.75rem',
                  color: 'var(--color-text-charcoal)',
                  lineHeight: '1.4'
                }}>
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      required
                      checked={enquiryForm.pdpaConsent}
                      onChange={e => setEnquiryForm({ ...enquiryForm, pdpaConsent: e.target.checked })}
                      style={{ marginTop: '2px', accentColor: 'var(--color-primary-green)' }}
                    />
                    <span>
                      <strong>PDPA Consent (Singapore Personal Data Protection Act 2012):</strong> I consent to the collection, use, and disclosure of my contact details by Singapore Home Intel to connect me with its appointed Council for Estate Agencies (CEA) licensed property representative (ERA Realty Network / Lic: L3002382K) for real estate advisory and transaction price assistance.
                    </span>
                  </label>
                </div>

                <button
                  type="submit"
                  disabled={agentLoading}
                  className="btn btn-primary"
                  style={{ width: '100%', marginTop: '6px', justifyContent: 'center', padding: '10px' }}
                >
                  {agentLoading ? 'Submitting...' : 'Request Direct Specialist Callback (Free)'}
                </button>
              </form>
            )}

            <div style={{ textAlign: 'right', marginTop: '12px' }}>
              <button className="btn" onClick={() => setShowModal(false)} style={{ fontSize: '0.8rem' }}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
