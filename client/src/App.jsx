import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { Building2, Database, Key, Percent, Layers, Calendar, ExternalLink, ShieldCheck, Info, FileText, AlertCircle } from 'lucide-react';
import SearchHeader from './components/SearchHeader';
import PropertyMap from './components/PropertyMap';
import AnalyticsCharts from './components/AnalyticsCharts';
import UraIngestionModal from './components/UraIngestionModal';
import LivabilityBadge from './components/LivabilityBadge';
import LivabilityDrawer from './components/LivabilityDrawer';
import RentalYieldDrawer from './components/RentalYieldDrawer';
import MonetizationBanner from './components/MonetizationBanner';
import { getDefaultDateRange } from './utils/dateUtils';

export default function App() {
  const [features, setFeatures] = useState({ leadCapture: false, dataSync: false });
  useEffect(() => {
    axios.get('/api/features').then(({ data }) => setFeatures(data)).catch(() => {});
  }, []);
  useEffect(() => {
    if (features.leadCapture && new URLSearchParams(window.location.search).get('enquire') === '1') setIsEnquiryModalOpen(true);
    if (!features.leadCapture) setIsEnquiryModalOpen(false);
  }, [features.leadCapture]);
  // Read initial view mode from URL ?mode=rental or default to 'sale'
  const [viewMode, setViewMode] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('mode') === 'rental' ? 'rental' : 'sale';
  });

  const unitType = 'sqft'; // Use per square feet only

  // Step 4.3.1: Read URL parameters on load (?project=, ?district=, ?street=, ?area=)
  const [filters, setFilters] = useState(() => {
    const { dateFrom, dateTo } = getDefaultDateRange(5);
    const params = new URLSearchParams(window.location.search);
    const urlProject = params.get('project');
    const urlDistrict = params.get('district');
    const urlStreet = params.get('street');
    const urlArea = params.get('area') || params.get('planningArea');

    return {
      projects: urlProject ? [urlProject] : [],
      street: urlStreet || null,
      district: urlDistrict || null,
      planningArea: urlArea || null,
      bedroomCount: 'all',
      radiusKm: null,
      centerCoords: null,
      dateFrom,
      dateTo,
      unitSizeMin: 0,
      unitSizeMax: 10000,
      priceMin: null,
      priceMax: null,
      tenure: 'all'
    };
  });

  const [analyticsData, setAnalyticsData] = useState({
    summary: { totalVolume: 0, medianPrice: 0, medianPsft: 0, minPrice: 0, maxPrice: 0 },
    timeSeries: [],
    scatterPoints: [],
    bedroomBreakdown: [],
    rentalCaveats: [],
    mapProjects: []
  });

  const [loading, setLoading] = useState(true);
  const [errorFeedback, setErrorFeedback] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);
  const [showAboutModal, setShowAboutModal] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [isEnquiryModalOpen, setIsEnquiryModalOpen] = useState(false);

  // Livability & Rental Detail Drawer states
  const [selectedDrawerProject, setSelectedDrawerProject] = useState(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [selectedRentalProject, setSelectedRentalProject] = useState(null);
  const [isRentalDrawerOpen, setIsRentalDrawerOpen] = useState(false);

  // Step 4.3.1: Handle ?enquire=1 and ?q= on initial load
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    const qParam = params.get('q');
    if (qParam && qParam.trim()) {
      axios.get(`/api/search/suggestions?q=${encodeURIComponent(qParam.trim())}`)
        .then(res => {
          const data = res.data;
          if (data.projects && data.projects.length > 0) {
            const match = data.projects[0];
            const lat = match.lat != null ? parseFloat(match.lat) : null;
            const lng = match.lng != null ? parseFloat(match.lng) : null;
            setFilters(prev => ({
              ...prev,
              projects: [match.name],
              centerCoords: !isNaN(lat) && !isNaN(lng) && lat && lng ? { lat, lng } : null
            }));
          } else if (data.streets && data.streets.length > 0) {
            setFilters(prev => ({ ...prev, street: data.streets[0] }));
          } else if (data.districts && data.districts.length > 0) {
            setFilters(prev => ({ ...prev, district: data.districts[0] }));
          } else if (data.planningAreas && data.planningAreas.length > 0) {
            setFilters(prev => ({ ...prev, planningArea: data.planningAreas[0] }));
          }
        })
        .catch(err => console.error('Error resolving search query param q:', err));
    }
  }, []);

  // Step 4.3.1: Sync filters and viewMode to URL via history.replaceState
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const params = new URLSearchParams(window.location.search);
    if (filters.projects && filters.projects.length === 1) {
      params.set('project', filters.projects[0]);
    } else {
      params.delete('project');
    }
    if (filters.district) {
      params.set('district', filters.district);
    } else {
      params.delete('district');
    }
    if (filters.street) {
      params.set('street', filters.street);
    } else {
      params.delete('street');
    }
    if (filters.planningArea) {
      params.set('area', filters.planningArea);
    } else {
      params.delete('area');
      params.delete('planningArea');
    }
    if (viewMode === 'rental') {
      params.set('mode', 'rental');
    } else {
      params.delete('mode');
    }
    // Clean up one-shot query parameters
    params.delete('q');
    params.delete('enquire');

    const newSearch = params.toString();
    const newUrl = newSearch ? `${window.location.pathname}?${newSearch}` : window.location.pathname;
    window.history.replaceState({}, '', newUrl);
  }, [filters.projects, filters.district, filters.street, filters.planningArea, viewMode]);

  const handleOpenLivabilityDrawer = async (projData) => {
    const proj = projData?.project || projData;
    const projectId = projData?.projectId || proj?.id || proj?.project_id;
    const livability = projData?.livability || proj?.livability;

    if (livability?.nearest && Object.keys(livability.nearest).length > 0) {
      setSelectedDrawerProject({ project: proj, livability });
      setIsDrawerOpen(true);
      return;
    }

    if (proj && livability) {
      setSelectedDrawerProject({ project: proj, livability });
      setIsDrawerOpen(true);
    }

    if (projectId) {
      try {
        const res = await axios.get(`/api/projects/${projectId}/livability`);
        setSelectedDrawerProject(res.data);
        setIsDrawerOpen(true);
      } catch (err) {
        console.error('Error fetching project livability:', err);
      }
    }
  };

  // Step 4.2.2: AbortController in fetchAnalytics to eliminate out-of-order race conditions
  const abortControllerRef = useRef(null);

  const fetchAnalytics = useCallback(async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    setErrorFeedback(null);
    try {
      const endpoint = viewMode === 'rental' ? '/api/analytics/rental-yields' : '/api/analytics/price-trends';
      const res = await axios.post(endpoint, {
        filters: {
          ...filters,
          unitType: 'sqft'
        }
      }, {
        signal: controller.signal
      });
      setAnalyticsData(res.data);
    } catch (err) {
      if (!axios.isCancel(err) && err.name !== 'CanceledError') {
        console.error(`Error loading ${viewMode} property analytics:`, err);
        setErrorFeedback(`Unable to load ${viewMode === 'rental' ? 'rental yield' : 'transaction price'} analytics. Please check your connection or retry.`);
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [filters, viewMode]);

  useEffect(() => {
    fetchAnalytics();
    return () => {
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, [fetchAnalytics]);

  const summary = analyticsData.summary || {};

  // Calculate Average Livability Score across currently visible map projects
  const mapProjList = analyticsData.mapProjects || [];
  const avgLivability = mapProjList.length > 0
    ? Math.round(mapProjList.reduce((acc, p) => acc + (p.livability?.score || 0), 0) / mapProjList.length)
    : 0;

  // Average sub-scores for metric summary card hover
  const avgSubScores = mapProjList.length > 0 ? {
    mrt: Math.round(mapProjList.reduce((acc, p) => acc + (p.livability?.subScores?.mrt || 0), 0) / mapProjList.length),
    school: Math.round(mapProjList.reduce((acc, p) => acc + (p.livability?.subScores?.school || 0), 0) / mapProjList.length),
    hawker: Math.round(mapProjList.reduce((acc, p) => acc + (p.livability?.subScores?.hawker || 0), 0) / mapProjList.length),
    supermarket: Math.round(mapProjList.reduce((acc, p) => acc + (p.livability?.subScores?.supermarket || 0), 0) / mapProjList.length),
    park: Math.round(mapProjList.reduce((acc, p) => acc + (p.livability?.subScores?.park || 0), 0) / mapProjList.length)
  } : { mrt: 0, school: 0, hawker: 0, supermarket: 0, park: 0 };

  return (
    <div className="app-container">
      {/* Top Header */}
      <header className="app-header">
        <div className="brand">
          <div className="brand-icon">
            <Building2 size={22} />
          </div>
          <div className="brand-title">Singapore Home Intel</div>
        </div>

        <div className="header-actions">
          {features.dataSync && (new URLSearchParams(window.location.search).get('admin') === '1' || import.meta.env.DEV) ? (
            <button className="btn btn-primary" onClick={() => setIsModalOpen(true)}>
              <Database size={16} /> Sync URA API Data
            </button>
          ) : (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '6px 14px',
              borderRadius: '20px',
              background: '#ECFDF5',
              border: '1px solid #A7F3D0',
              color: '#065F46',
              fontSize: '0.82rem',
              fontWeight: 600
            }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10B981', display: 'inline-block' }}></span>
              URA & OneMap Verified Data
            </div>
          )}
        </div>
      </header>

      {/* Main Dashboard Content */}
      <main className="main-content">
        {/* Unified Search & Filters Header */}
        <SearchHeader
          filters={filters}
          setFilters={setFilters}
          unitType={unitType}
          viewMode={viewMode}
          setViewMode={setViewMode}
        />

        {/* Analytics Load Error Banner */}
        {errorFeedback && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: '#FEF2F2',
            border: '1px solid #FECACA',
            color: '#991B1B',
            padding: '12px 18px',
            borderRadius: '10px',
            marginBottom: '16px',
            fontSize: '0.9rem'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <AlertCircle size={18} />
              <span>{errorFeedback}</span>
            </div>
            <button
              onClick={() => fetchAnalytics()}
              style={{
                background: '#DC2626',
                color: '#FFFFFF',
                border: 'none',
                borderRadius: '6px',
                padding: '6px 12px',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '0.82rem'
              }}
            >
              Retry
            </button>
          </div>
        )}

        {/* Metrics Summary Cards */}
        {viewMode === 'rental' ? (
          <div className="metrics-grid">
            <div className="metric-card terracotta">
              <span className="metric-title">Median Rent</span>
              <div className="metric-value" style={{ color: 'var(--color-primary-terracotta)' }}>
                ${summary.medianRent ? summary.medianRent.toLocaleString() : '0'} <span style={{ fontSize: '1rem', color: 'var(--color-text-muted)', fontWeight: 400 }}>/mo</span>
              </div>
              <span className="metric-sub">Past 24 months ({summary.totalLeases || 0} lease agreements)</span>
            </div>

            <div className="metric-card amber">
              <span className="metric-title">Average Gross Rental Yield</span>
              <div className="metric-value" style={{ color: summary.avgGrossYield >= 4.25 ? '#10B981' : summary.avgGrossYield >= 3.25 ? '#D97706' : '#CB6D51' }}>
                {summary.avgGrossYield ? `${summary.avgGrossYield}%` : '0%'}
              </div>
              <span className="metric-sub">
                {summary.avgGrossYield >= 4.25 ? '🟢 High Yield' : summary.avgGrossYield >= 3.25 ? '🟡 Moderate Yield' : '🟠 Trophy Capital Growth'}
              </span>
            </div>

            <div className="metric-card teal">
              <span className="metric-title">Median Rental Rate ($/SQFT)</span>
              <div className="metric-value" style={{ color: 'var(--color-accent-teal)' }}>
                ${summary.medianRentPsft || 0} <span style={{ fontSize: '1rem', color: 'var(--color-text-muted)', fontWeight: 400 }}>/sqft/mo</span>
              </div>
              <span className="metric-sub">Rate range: ${summary.rentMinMaxRange?.min || 0} – ${summary.rentMinMaxRange?.max || 0}/mo</span>
            </div>

            <div className="metric-card">
              <span className="metric-title">Avg Livability Index</span>
              <div className="metric-value">
                <LivabilityBadge
                  livability={{
                    score: avgLivability,
                    label: avgLivability >= 80 ? "Walker's Paradise" : avgLivability >= 65 ? "Highly Walkable" : avgLivability >= 50 ? "Somewhat Walkable" : "Car Dependent",
                    color: "#CB6D51",
                    subScores: avgSubScores
                  }}
                  size="large"
                />
              </div>
              <span className="metric-sub">Across {mapProjList.length} filtered developments</span>
            </div>
          </div>
        ) : (
          <div className="metrics-grid">
            <div className="metric-card">
              <span className="metric-title">Median Transaction Price</span>
              <div className="metric-value" style={{ color: 'var(--color-primary-green)' }}>
                ${summary.medianPrice ? Math.round(summary.medianPrice).toLocaleString() : '0'} <span style={{ fontSize: '1rem', color: 'var(--color-text-muted)', fontWeight: 400 }}>SGD</span>
              </div>
              <span className="metric-sub">Past 24 months ({summary.totalVolume || 0} transactions)</span>
            </div>

            <div className="metric-card teal">
              <span className="metric-title">Median Unit Rate ($/SQFT)</span>
              <div className="metric-value" style={{ color: 'var(--color-accent-teal)' }}>
                ${summary.medianPsft ? Math.round(summary.medianPsft).toLocaleString() : '0'} <span style={{ fontSize: '1rem', color: 'var(--color-text-muted)', fontWeight: 400 }}>/sqft</span>
              </div>
              <span className="metric-sub">Past 24 months median rate</span>
            </div>

            <div className="metric-card terracotta">
              <span className="metric-title">Avg Livability Index</span>
              <div className="metric-value">
                <LivabilityBadge
                  livability={{
                    score: avgLivability,
                    label: avgLivability >= 80 ? "Walker's Paradise" : avgLivability >= 65 ? "Highly Walkable" : avgLivability >= 50 ? "Somewhat Walkable" : "Car Dependent",
                    color: "#CB6D51",
                    subScores: avgSubScores
                  }}
                  size="large"
                />
              </div>
              <span className="metric-sub">Across {mapProjList.length} filtered developments</span>
            </div>

            <div className="metric-card amber">
              <span className="metric-title">Transaction Price Range</span>
              <div className="metric-value" style={{ color: '#D97706', fontSize: '1.4rem' }}>
                ${summary.minPrice ? (summary.minPrice / 1e6).toFixed(2) : '0'}M – ${summary.maxPrice ? (summary.maxPrice / 1e6).toFixed(2) : '0'}M
              </div>
              <span className="metric-sub">Avg Transaction Price: ${summary.averagePrice ? Math.round(summary.averagePrice).toLocaleString() : '0'}</span>
            </div>
          </div>
        )}

        {/* High-Intent Native Monetization: Accredited CEA Agent Advisory */}
        {features.leadCapture && <MonetizationBanner
          variant="agent"
          isEnquiryModalOpen={isEnquiryModalOpen}
          onToggleEnquiryModal={setIsEnquiryModalOpen}
        />}

        {/* Main Grid: Charts & GIS Map */}
        <div className="dashboard-grid">
          <AnalyticsCharts
            timeSeries={analyticsData.timeSeries}
            scatterPoints={analyticsData.scatterPoints}
            bedroomBreakdown={analyticsData.bedroomBreakdown}
            unitType={unitType}
            viewMode={viewMode}
          />

          <PropertyMap
            mapProjects={analyticsData.mapProjects}
            filters={filters}
            setFilters={setFilters}
            unitType={unitType}
            viewMode={viewMode}
            onOpenLivabilityDrawer={handleOpenLivabilityDrawer}
          />
        </div>

        {/* High-Intent Native Monetization: Weekly Deals Newsletter */}
        {features.leadCapture && <MonetizationBanner variant="newsletter" />}

        {/* Detailed Caveats / Tenancy Transactions Log Table */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">
              <Layers size={18} color={viewMode === 'rental' ? 'var(--color-primary-terracotta)' : 'var(--color-primary-green)'} />
              {viewMode === 'rental'
                ? `Recent Tenancy Agreements Log (${analyticsData.rentalCaveats?.length || 0}${analyticsData.totalCount ? ` of ${analyticsData.totalCount.toLocaleString()}` : ''} Listed)`
                : `Recent Caveat Transactions Log (${analyticsData.scatterPoints?.length || 0}${analyticsData.totalCount ? ` of ${analyticsData.totalCount.toLocaleString()}` : ''} Listed)`}
            </h3>
          </div>

          <div className="data-table-wrapper">
            {viewMode === 'rental' ? (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Development</th>
                    <th>Lease Date</th>
                    <th>Monthly Rent (SGD)</th>
                    <th>Rental Rate</th>
                    <th>Bedroom Type</th>
                    <th>Floor Area Range</th>
                    <th>Est. Gross Yield</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {analyticsData.rentalCaveats && analyticsData.rentalCaveats.length > 0 ? (
                    analyticsData.rentalCaveats.map((r, idx) => {
                      const matchProj = mapProjList.find(p => p && (p.id === r.projectId || p.name === r.projectName));
                      const rateVal = unitType === 'sqm' ? `$${r.rentPsqm} /sqm` : `$${r.rentPsft} /sqft`;
                      const yieldColor = r.grossYield == null ? 'var(--color-text-muted)' : r.grossYield >= 4.25 ? '#10B981' : r.grossYield >= 3.25 ? '#D97706' : '#CB6D51';

                      return (
                        <tr key={r.rentalId || idx}>
                          <td style={{ fontWeight: 600, color: 'var(--color-text-charcoal)' }}>{r.projectName}</td>
                          <td style={{ color: 'var(--color-text-muted)' }}>{r.leaseDate}</td>
                          <td style={{ fontWeight: 700, color: 'var(--color-primary-green)' }}>
                            ${r.rentSgd ? r.rentSgd.toLocaleString() : '0'} /mo
                          </td>
                          <td style={{ color: 'var(--color-accent-teal)', fontWeight: 600 }}>{rateVal}/mo</td>
                          <td>
                            <span style={{ background: '#F1F5F9', padding: '3px 8px', borderRadius: '6px', fontSize: '0.78rem', fontWeight: 600, color: '#334155' }}>
                              {r.bedroomCount}
                            </span>
                          </td>
                          <td>{r.floorAreaRange}</td>
                          <td>
                            <span style={{ fontWeight: 800, color: yieldColor, fontSize: r.grossYield != null ? 'inherit' : '0.78rem' }}>
                              {r.grossYield != null ? `${r.grossYield}%` : 'N/A — no recent sales'}
                            </span>
                          </td>
                          <td>
                            <button
                              onClick={() => {
                                const target = matchProj || {
                                  name: r.projectName,
                                  street: r.streetName,
                                  district: r.district,
                                  segment: 'RCR',
                                  medianRent: r.rentSgd,
                                  medianRentPsft: r.rentPsft,
                                  medianSaleValuation: r.estimatedSaleValuation,
                                  grossYield: r.grossYield
                                };
                                setSelectedRentalProject(target);
                                setIsRentalDrawerOpen(true);
                              }}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: 'var(--color-primary-terracotta)',
                                fontWeight: 600,
                                fontSize: '0.78rem',
                                cursor: 'pointer',
                                textDecoration: 'underline'
                              }}
                            >
                              Yield Breakdown
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan="8" style={{ textAlign: 'center', color: 'var(--color-text-muted)', padding: '24px' }}>
                        No tenancy agreements found for the selected criteria.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Development</th>
                    <th>Livability Rating</th>
                    <th>Transaction Date</th>
                    <th>Sale Price (SGD)</th>
                    <th>Rate ($/SQFT)</th>
                    <th>Unit Size</th>
                    <th>Floor Tier</th>
                    <th>Type of Sale</th>
                  </tr>
                </thead>
                <tbody>
                  {analyticsData.scatterPoints && analyticsData.scatterPoints.length > 0 ? (
                    analyticsData.scatterPoints.slice().reverse().map((tx, idx) => {
                      const matchProj = mapProjList.find(p => p && (p.id === tx.projectId || p.name === tx.projectName));
                      return (
                        <tr key={tx.id || idx}>
                          <td style={{ fontWeight: 600, color: 'var(--color-text-charcoal)' }}>{tx.projectName || 'Development'}</td>
                          <td>
                            {matchProj && matchProj.livability ? (
                              <LivabilityBadge
                                livability={matchProj.livability}
                                size="small"
                                onClick={() => handleOpenLivabilityDrawer({ project: matchProj, livability: matchProj.livability })}
                              />
                            ) : (
                              <span style={{ color: '#94A3B8', fontSize: '0.78rem' }}>N/A</span>
                            )}
                          </td>
                          <td style={{ color: 'var(--color-text-muted)' }}>{tx.date || '-'}</td>
                          <td style={{ fontWeight: 700, color: 'var(--color-primary-green)' }}>
                            ${tx.priceSgd ? tx.priceSgd.toLocaleString() : '0'}
                          </td>
                          <td style={{ color: 'var(--color-accent-teal)', fontWeight: 600 }}>
                            ${tx.psft ? tx.psft.toLocaleString() : '0'} /sqft
                          </td>
                          <td>{tx.areaSqft ? tx.areaSqft.toLocaleString() : 0} sqft</td>
                          <td>
                            <span style={{
                              background: 'var(--color-bg-sand)',
                              color: 'var(--color-text-charcoal)',
                              padding: '3px 8px',
                              borderRadius: '6px',
                              fontSize: '0.78rem',
                              fontWeight: 600
                            }}>
                              {tx.floorRange || 'Unknown'}
                            </span>
                          </td>
                          <td>
                            <span style={{
                              color: tx.typeOfSale === 'New Sale' ? 'var(--color-primary-green)' : tx.typeOfSale === 'Sub Sale' ? 'var(--color-primary-terracotta)' : 'var(--color-text-muted)',
                              fontWeight: 600
                            }}>
                              {tx.typeOfSale || 'Resale'}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan="8" style={{ textAlign: 'center', color: 'var(--color-text-muted)', padding: '24px' }}>
                        No transaction caveats found for the selected criteria.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </main>

      {/* Footer & Legal Compliance Section */}
      <footer style={{
        marginTop: 'auto',
        background: '#FAF6F0',
        borderTop: '1px solid var(--color-border-subtle)',
        padding: '32px 24px',
        color: 'var(--color-text-muted)',
        fontSize: '0.8rem',
        lineHeight: 1.6
      }}>
        <div style={{ maxWidth: '1440px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <div style={{ fontWeight: 700, color: 'var(--color-text-charcoal)', fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Building2 size={18} color="var(--color-primary-green)" />
              Singapore Home Intel
            </div>
            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
              <a href="#about" onClick={(e) => { e.preventDefault(); setShowAboutModal(true); }} style={{ color: 'var(--color-primary-green)', fontWeight: 600, textDecoration: 'none' }}>About</a>
              <a href="#privacy" onClick={(e) => { e.preventDefault(); setShowPrivacyModal(true); }} style={{ color: 'var(--color-primary-green)', fontWeight: 600, textDecoration: 'none' }}>Privacy Policy & PDPA Notice</a>
              <a href="#terms" onClick={(e) => { e.preventDefault(); setShowTermsModal(true); }} style={{ color: 'var(--color-primary-green)', fontWeight: 600, textDecoration: 'none' }}>Terms of Service</a>
              <a href="https://data.gov.sg/open-data-licence" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-primary-green)', textDecoration: 'none', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                Singapore Open Data Licence <ExternalLink size={12} />
              </a>
            </div>
          </div>
          <div style={{ borderTop: '1px solid rgba(54, 69, 79, 0.08)', paddingTop: '12px', fontSize: '0.75rem', color: '#8898AA' }}>
            <p>
              <strong>Data Attribution & Integrity:</strong> Private residential transaction caveats and quarterly rental contracts are sourced from the <strong>Urban Redevelopment Authority (URA) Data Service</strong> under the <a href="https://data.gov.sg/open-data-licence" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>Singapore Open Data Licence</a>. Geocoding utilizes SVY21 coordinate conversion from the Singapore Land Authority (SLA) OneMap API. Spatial amenities include OpenStreetMap data (&copy; OpenStreetMap contributors, ODbL). Note: URA rental records provide approximate floor area ranges, and developments without specific coordinates are located at postal district centroids.
            </p>
            <p style={{ marginTop: '6px' }}>
              <strong>Disclaimer:</strong> Singapore Home Intel is an independent research platform and is not affiliated with, sponsored by, or endorsed by the Urban Redevelopment Authority (URA), the Singapore Land Authority (SLA), or the Government of Singapore. All property valuation benchmarks, rental yields, and livability indices are computational estimates intended for analytical and informational purposes only.
            </p>
          </div>
        </div>
      </footer>

      {/* Slide-over Livability Details Drawer */}
      <LivabilityDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        projectData={selectedDrawerProject}
      />

      {/* Slide-over Rental Yield Details Drawer */}
      <RentalYieldDrawer
        isOpen={isRentalDrawerOpen}
        onClose={() => setIsRentalDrawerOpen(false)}
        project={selectedRentalProject}
      />

      {/* Ingestion & Seed Modal */}
      <UraIngestionModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onIngestionComplete={fetchAnalytics}
      />

      {/* About Modal */}
      {showAboutModal && (
        <div className="modal-overlay">
          <div className="modal-card" style={{ maxWidth: '580px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.15rem', color: 'var(--color-text-charcoal)' }}>
                <Info size={20} color="var(--color-primary-green)" />
                About Singapore Home Intel
              </h3>
              <ExternalLink size={18} style={{ cursor: 'pointer', opacity: 0.7 }} onClick={() => setShowAboutModal(false)} />
            </div>

            <div style={{ fontSize: '0.84rem', color: 'var(--color-text-charcoal)', lineHeight: '1.6', marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <p>
                <strong>Singapore Home Intel</strong> provides property buyers, homeowners, and investors with transparent, algorithmically verified transaction price analytics, gross rental yields, and walkable livability indices across Singapore private residential properties.
              </p>
              <p>
                <strong>Methodology:</strong> Every metric is derived directly from official government caveats released via the URA Data Service, matched against OneMap SVY21 geospatial coordinates and neighborhood amenities. Rolling 24-month medians protect against anomalous single-transaction spikes.
              </p>
              <p>
                For questions, partnership inquiries, or feedback, email us at <a href="mailto:contact@homeintel.sg" style={{ color: 'var(--color-primary-green)', fontWeight: 600 }}>contact@homeintel.sg</a>.
              </p>
            </div>

            <div style={{ textAlign: 'right', marginTop: '16px' }}>
              <button className="btn btn-primary" onClick={() => setShowAboutModal(false)} style={{ fontSize: '0.82rem' }}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Terms of Service Modal */}
      {showTermsModal && (
        <div className="modal-overlay">
          <div className="modal-card" style={{ maxWidth: '620px', maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.15rem', color: 'var(--color-text-charcoal)' }}>
                <FileText size={20} color="var(--color-primary-green)" />
                Terms of Service
              </h3>
              <ExternalLink size={18} style={{ cursor: 'pointer', opacity: 0.7 }} onClick={() => setShowTermsModal(false)} />
            </div>

            <div style={{ fontSize: '0.82rem', color: 'var(--color-text-charcoal)', lineHeight: '1.6', marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <p>
                <strong>1. Nature of Computational Estimates</strong><br />
                All transaction price summaries, gross rental yield metrics, and GIS livability scores are computational calculations based upon historical data. They do not constitute certified professional appraisals, financial advice, or formal property valuations under Singapore law.
              </p>
              <p>
                <strong>2. Independent Verification</strong><br />
                Users must independently verify property facts, caveats, loan requirements, and encumbrances with Singapore Land Authority (SLA) title searches and accredited Council for Estate Agencies (CEA) property representatives before executing financial transactions.
              </p>
              <p>
                <strong>3. Limitation of Liability</strong><br />
                Singapore Home Intel and its operators shall not be liable for any financial decisions, losses, or commitments made based on information presented on this platform.
              </p>
            </div>

            <div style={{ textAlign: 'right', marginTop: '16px' }}>
              <button className="btn btn-primary" onClick={() => setShowTermsModal(false)} style={{ fontSize: '0.82rem' }}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Singapore PDPA & Privacy Policy Modal */}
      {showPrivacyModal && (
        <div className="modal-overlay">
          <div className="modal-card" style={{ maxWidth: '640px', maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.2rem', color: 'var(--color-text-charcoal)' }}>
                <ShieldCheck size={22} color="var(--color-primary-green)" />
                Privacy Policy & Singapore PDPA Notice
              </h3>
              <ExternalLink size={18} style={{ cursor: 'pointer', opacity: 0.7 }} onClick={() => setShowPrivacyModal(false)} />
            </div>

            <div style={{ fontSize: '0.82rem', color: 'var(--color-text-charcoal)', lineHeight: '1.6', marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <p>
                <strong>1. Commitment to Singapore PDPA 2012</strong><br />
                Singapore Home Intel is committed to safeguarding personal data in compliance with the <strong>Singapore Personal Data Protection Act 2012 (PDPA)</strong>. This notice explains how personal data is collected, used, disclosed, and protected.
              </p>

              <p>
                <strong>2. Collection of Personal Data</strong><br />
                We only collect personal information when you explicitly choose to provide it:
                <br />• <strong>Property Deal Watchlist (Newsletter):</strong> Email address for delivering weekly analytical property market digests upon double opt-in verification.
                <br />• <strong>Real Estate Advisory Requests:</strong> Name, email address, WhatsApp/phone number, and property development of interest.
                <br /><em>Note: We never ask for or collect NRIC, FIN, or confidential banking numbers.</em>
              </p>

              <p>
                <strong>3. Purpose of Processing & CEA Agent Introductions</strong><br />
                Your data is processed strictly for the purpose for which it was provided:
                <br />• To deliver weekly property analytical briefings upon your opt-in consent.
                <br />• To connect you with our appointed Council for Estate Agencies (CEA) licensed property representative (ERA Realty Network / Lic: L3002382K) for advisory and on-the-ground transaction price assistance.
              </p>

              <p>
                <strong>4. Protection Against Telemarketing & Third Parties</strong><br />
                We do not sell, rent, trade, or distribute your personal data to mass telemarketers or external advertisers. Unconverted enquiry records are automatically purged after 12 months.
              </p>

              <p>
                <strong>5. Your Rights: Consent Withdrawal & Data Access</strong><br />
                Under the PDPA, you may at any time withdraw your consent for future communications or request access to and correction of your personal data. All newsletters include a 1-click unsubscribe option. For inquiries, contact our Data Protection representative at <strong>dpo@homeintel.sg</strong>.
              </p>
            </div>

            <div style={{ textAlign: 'right', marginTop: '16px' }}>
              <button className="btn btn-primary" onClick={() => setShowPrivacyModal(false)} style={{ fontSize: '0.82rem' }}>
                Close Notice
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
