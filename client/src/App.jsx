import AccessibleDialog from './components/AccessibleDialog';
import { decodeMapProjects } from './utils/mapContract';
import {mapSearchKey} from './utils/mapPresentation';
import React, { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import axios from 'axios';
import { Building2, Database, Key, Percent, Layers, Calendar, ExternalLink, ShieldCheck, Info, FileText, AlertCircle } from 'lucide-react';
import SearchHeader from './components/SearchHeader';
const PropertyMap = lazy(() => import('./components/PropertyMap'));
const AnalyticsCharts = lazy(() => import('./components/AnalyticsCharts'));
const UraIngestionModal = lazy(() => import('./components/UraIngestionModal'));
import LivabilityBadge from './components/LivabilityBadge';
const LivabilityDrawer = lazy(() => import('./components/LivabilityDrawer'));
const RentalYieldDrawer = lazy(() => import('./components/RentalYieldDrawer'));
import MonetizationBanner from './components/MonetizationBanner';
import { readSearchFilters, writeSearchFilters, selectLocation, updateSearchFilters } from './utils/searchState';

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
  const [filters, setFilterState] = useState(() => readSearchFilters(window.location.search));
  const setFilters = useCallback(update => setFilterState(prev => updateSearchFilters(prev, update)), []);
  const changeViewMode = mode => {
    if(mode === viewMode) return;
    setFilters(prev => ({...prev, priceMin:null, priceMax:null, page:1}));
    setViewMode(mode);
  };
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
            setFilters(prev => selectLocation(prev, {
              projects: [match.name],
              propertyType: 'all',
              centerCoords: !isNaN(lat) && !isNaN(lng) && lat && lng ? { lat, lng } : null
            }));
          } else if (data.streets && data.streets.length > 0) {
            setFilters(prev => selectLocation(prev, {street: data.streets[0]}));
          } else if (data.districts && data.districts.length > 0) {
            setFilters(prev => selectLocation(prev, {district: data.districts[0]}));
          } else if (data.planningAreas && data.planningAreas.length > 0) {
            setFilters(prev => selectLocation(prev, {planningArea: data.planningAreas[0]}));
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
    const newSearch = writeSearchFilters(filters, viewMode, window.location.search);
    const newUrl = newSearch ? `${window.location.pathname}?${newSearch}` : window.location.pathname;
    window.history.replaceState({}, '', newUrl);
  }, [filters, viewMode]);
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
      const requestFilters={...filters,unitType:'sqft'};
      const options={signal:controller.signal};
      const [res,map]=await Promise.all([
        axios.post(endpoint,{filters:requestFilters},options),
        axios.post('/api/analytics/map',{mode:viewMode,filters:requestFilters},options)
      ]);
      const lastPage=Math.max(1,res.data.totalPages || 1);
      if((filters.page || 1)>lastPage) {setFilters(prev=>({...prev,page:lastPage}));return;}
      setAnalyticsData({...res.data,mapProjects:decodeMapProjects(map.data),mapSearchKey:mapSearchKey(filters)});
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
  const scoredProjects = mapProjList.filter(p => p.livability?.score != null);
  const avgLivability = scoredProjects.length > 0
    ? Math.round(scoredProjects.reduce((acc, p) => acc + p.livability.score, 0) / scoredProjects.length)
    : null;

  // Average sub-scores for metric summary card hover
  const avgSubScores = scoredProjects.length > 0 ? {
    mrt: Math.round(scoredProjects.reduce((acc, p) => acc + (p.livability?.subScores?.mrt || 0), 0) / scoredProjects.length),
    school: Math.round(scoredProjects.reduce((acc, p) => acc + (p.livability?.subScores?.school || 0), 0) / scoredProjects.length),
    hawker: Math.round(scoredProjects.reduce((acc, p) => acc + (p.livability?.subScores?.hawker || 0), 0) / scoredProjects.length),
    supermarket: Math.round(scoredProjects.reduce((acc, p) => acc + (p.livability?.subScores?.supermarket || 0), 0) / scoredProjects.length),
    park: Math.round(scoredProjects.reduce((acc, p) => acc + (p.livability?.subScores?.park || 0), 0) / scoredProjects.length)
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
              URA transactions · Location estimates
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
          setViewMode={changeViewMode}
        />

        {loading && <p role="status" aria-live="polite">Loading market data…</p>}
        {!loading && !errorFeedback && analyticsData.totalCount===0 && <p role="status">No recorded transactions match these filters.</p>}
        {/* Analytics Load Error Banner */}
        {errorFeedback && (
          <div role="alert" style={{
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
                ${summary.medianRent ? summary.medianRent.toLocaleString() : 'N/A'} <span style={{ fontSize: '1rem', color: 'var(--color-text-muted)', fontWeight: 400 }}>/mo</span>
              </div>
              <span className="metric-sub">Selected period ({summary.totalLeases || 0} lease agreements)</span>
              {summary.unknownAreaLeases > 0 && <span className="metric-sub">Includes {summary.unknownAreaLeases} leases with unknown floor area; these have no per-square-foot rate or yield.</span>}
            </div>

            <div className="metric-card amber">
              <span className="metric-title">Median Project Gross Yield</span>
              <div className="metric-value" style={{ color: summary.avgGrossYield >= 4.25 ? '#10B981' : summary.avgGrossYield >= 3.25 ? '#D97706' : '#CB6D51' }}>
                {summary.avgGrossYield ? `${summary.avgGrossYield}%` : 'N/A'}
              </div>
              <span className="metric-sub">
                {summary.avgGrossYield == null ? 'Insufficient transactions (minimum 3 sales and 3 usable rentals)' : 'Median across eligible projects; each project counts once'}
              </span>
            </div>

            <div className="metric-card teal">
              <span className="metric-title">Median Rental Rate ($/SQFT)</span>
              <div className="metric-value" style={{ color: 'var(--color-accent-teal)' }}>
                ${summary.medianRentPsft ?? 'N/A'} <span style={{ fontSize: '1rem', color: 'var(--color-text-muted)', fontWeight: 400 }}>/sqft/mo</span>
              </div>
              <span className="metric-sub">Rate range: ${summary.rentMinMaxRange?.min || 0} – ${summary.rentMinMaxRange?.max || 0}/mo</span>
            </div>

            <div className="metric-card">
              <span className="metric-title">Avg Livability Index</span>
              <div className="metric-value">
                <LivabilityBadge
                  livability={{
                    score: avgLivability,
                    label: avgLivability == null ? 'Location unavailable' : avgLivability >= 80 ? "High amenity proximity" : avgLivability >= 65 ? "Good amenity proximity" : avgLivability >= 50 ? "Moderate amenity proximity" : "Limited catalog proximity",
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
                ${summary.medianPrice ? Math.round(summary.medianPrice).toLocaleString() : 'N/A'} <span style={{ fontSize: '1rem', color: 'var(--color-text-muted)', fontWeight: 400 }}>SGD</span>
              </div>
              <span className="metric-sub">Selected period ({summary.totalVolume || 0} transactions)</span>
            </div>

            <div className="metric-card teal">
              <span className="metric-title">Median Unit Rate ($/SQFT)</span>
              <div className="metric-value" style={{ color: 'var(--color-accent-teal)' }}>
                ${summary.medianPsft ? Math.round(summary.medianPsft).toLocaleString() : 'N/A'} <span style={{ fontSize: '1rem', color: 'var(--color-text-muted)', fontWeight: 400 }}>/sqft</span>
              </div>
              <span className="metric-sub">Selected-period median rate</span>
            </div>

            <div className="metric-card terracotta">
              <span className="metric-title">Avg Livability Index</span>
              <div className="metric-value">
                <LivabilityBadge
                  livability={{
                    score: avgLivability,
                    label: avgLivability == null ? 'Location unavailable' : avgLivability >= 80 ? "High amenity proximity" : avgLivability >= 65 ? "Good amenity proximity" : avgLivability >= 50 ? "Moderate amenity proximity" : "Limited catalog proximity",
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
                ${summary.minPrice ? (summary.minPrice / 1e6).toFixed(2) : 'N/A'}M – ${summary.maxPrice ? (summary.maxPrice / 1e6).toFixed(2) : 'N/A'}M
              </div>
              <span className="metric-sub">Avg Transaction Price: ${summary.averagePrice ? Math.round(summary.averagePrice).toLocaleString() : 'N/A'}</span>
            </div>
          </div>
        )}

        {/* High-Intent Native Monetization: Real Estate Agent Advisory */}
        {features.leadCapture && <MonetizationBanner
          advisoryPartnerName={features.advisoryPartnerName}
          advisoryPartnerRegistration={features.advisoryPartnerRegistration}
          variant="agent"
          isEnquiryModalOpen={isEnquiryModalOpen}
          onToggleEnquiryModal={setIsEnquiryModalOpen}
        />}

        {/* Main Grid: Charts & GIS Map */}
        <div className="dashboard-grid">
          <Suspense fallback={<p role="status">Loading charts and map…</p>}>
          <AnalyticsCharts
            timeSeries={analyticsData.timeSeries}
            scatterPoints={analyticsData.scatterPoints}
            bedroomBreakdown={analyticsData.bedroomBreakdown}
            unitType={unitType}
            viewMode={viewMode}
          />

          <PropertyMap
            mapProjects={analyticsData.mapProjects}
            loadedSearchKey={analyticsData.mapSearchKey}
            filters={filters}
            setFilters={setFilters}
            unitType={unitType}
            viewMode={viewMode}
            onOpenLivabilityDrawer={handleOpenLivabilityDrawer}
          />
          </Suspense>
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

          <nav aria-label="Transaction pages" style={{display:'flex',alignItems:'center',gap:'12px',flexWrap:'wrap',marginBottom:'12px'}}>
            <button className="btn" disabled={loading || (filters.page || 1) <= 1}
              onClick={() => setFilters(prev => ({...prev,page:Math.max(1,(prev.page || 1)-1)}))}>Previous page</button>
            <span>Page {filters.page || 1} of {Math.max(1,analyticsData.totalPages || 1)}</span>
            <button className="btn" disabled={loading || (filters.page || 1) >= (analyticsData.totalPages || 1)}
              onClick={() => setFilters(prev => ({...prev,page:(prev.page || 1)+1}))}>Next page</button>
            <span style={{color:'var(--color-text-muted)',fontSize:'0.8rem'}}>Summary and map cover all matching records.</span>
          </nav>
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
                      const rate = unitType === 'sqm' ? r.rentPsqm : r.rentPsft;
                      const rateVal = rate == null ? 'N/A — Floor area unavailable' : `$${rate} /${unitType}`;
                      const yieldColor = r.grossYield == null ? 'var(--color-text-muted)' : r.grossYield >= 4.25 ? '#10B981' : r.grossYield >= 3.25 ? '#D97706' : '#CB6D51';

                      return (
                        <tr key={r.rentalId || idx}>
                          <td style={{ fontWeight: 600, color: 'var(--color-text-charcoal)' }}>{r.projectName}</td>
                          <td style={{ color: 'var(--color-text-muted)' }}>{r.leaseDate}</td>
                          <td style={{ fontWeight: 700, color: 'var(--color-primary-green)' }}>
                            ${r.rentSgd ? r.rentSgd.toLocaleString() : 'N/A'} /mo
                          </td>
                          <td style={{ color: 'var(--color-accent-teal)', fontWeight: 600 }}>{rateVal}{rate == null ? '' : '/mo'}</td>
                          <td>
                            <span style={{ background: '#F1F5F9', padding: '3px 8px', borderRadius: '6px', fontSize: '0.78rem', fontWeight: 600, color: '#334155' }}>
                              {r.bedroomCount}
                            </span>
                          </td>
                          <td>{r.floorAreaRange}</td>
                          <td>
                            <span style={{ fontWeight: 800, color: yieldColor, fontSize: r.grossYield != null ? 'inherit' : '0.78rem' }}>
                              {r.grossYield != null ? `${r.grossYield}%` : 'N/A — Insufficient transactions'}
                            </span>
                          </td>
                          <td>
                            <button
                              onClick={() => {
                                const target = matchProj || {
                                  yieldBasis: 'individual-rental',
                                  name: r.projectName,
                                  street: r.streetName,
                                  district: r.district,
                                  segment: 'RCR',
                                  medianRent: r.rentSgd,
                                  medianRentPsft: r.rentPsft,
                                  medianSaleValuation: r.estimatedSaleValuation,
                                  medianSalePsft: r.saleBenchmark?.medianPsft,
                                  saleBenchmark: r.saleBenchmark,
                                  usableRentalCount: r.usableRentalCount,
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
                        No tenancy agreements match these filters. Check Property Type, dates and other filters.
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
                    analyticsData.scatterPoints.map((tx, idx) => {
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
                            ${tx.priceSgd ? tx.priceSgd.toLocaleString() : 'N/A'}
                          </td>
                          <td style={{ color: 'var(--color-accent-teal)', fontWeight: 600 }}>
                            ${tx.psft ? tx.psft.toLocaleString() : 'N/A'} /sqft
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
                        No transaction caveats match these filters. Check Property Type, dates and other filters.
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
      {isDrawerOpen && <Suspense fallback={<p role="status">Loading details…</p>}>
      <LivabilityDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        projectData={selectedDrawerProject}
      />
      </Suspense>}

      {/* Slide-over Rental Yield Details Drawer */}
      {isRentalDrawerOpen && <Suspense fallback={<p role="status">Loading details…</p>}>
      <RentalYieldDrawer
        isOpen={isRentalDrawerOpen}
        onClose={() => setIsRentalDrawerOpen(false)}
        project={selectedRentalProject}
      />
      </Suspense>}

      {/* Ingestion & Seed Modal */}
      {isModalOpen && <Suspense fallback={<p role="status">Loading details…</p>}>
      <UraIngestionModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onIngestionComplete={fetchAnalytics}
      />
      </Suspense>}

      {/* About Modal */}
      {showAboutModal && (
        <div className="modal-overlay">
          <AccessibleDialog label="About Singapore Home Intel" onClose={() => setShowAboutModal(false)} className="modal-card" style={{ maxWidth: '580px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.15rem', color: 'var(--color-text-charcoal)' }}>
                <Info size={20} color="var(--color-primary-green)" />
                About Singapore Home Intel
              </h3>
              <button type="button" className="icon-button" aria-label="Close dialog" onClick={() => setShowAboutModal(false)}><ExternalLink size={18} /></button>
            </div>

            <div style={{ fontSize: '0.84rem', color: 'var(--color-text-charcoal)', lineHeight: '1.6', marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <p>
                <strong>Singapore Home Intel</strong> provides property buyers, homeowners, and investors with transparent, historical transaction price analytics, gross rental yields, and amenity proximity estimates from an incomplete catalog across Singapore private residential properties.
              </p>
              <p>
                <strong>Methodology:</strong> Transaction summaries follow your selected period and filters. Gross yields compare each project’s median rental psf with its sale median over the 24-month window ending on your selected end date, using at least three usable records on each side. The headline is the median of eligible project yields, with each project counted once. Rental area bands use midpoint estimates. Amenity coverage is incomplete; distances are straight-line estimates. Unreviewed project merges are excluded.
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
          </AccessibleDialog>
        </div>
      )}

      {/* Terms of Service Modal */}
      {showTermsModal && (
        <div className="modal-overlay">
          <AccessibleDialog label="Terms of Service" onClose={() => setShowTermsModal(false)} className="modal-card" style={{ maxWidth: '620px', maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.15rem', color: 'var(--color-text-charcoal)' }}>
                <FileText size={20} color="var(--color-primary-green)" />
                Terms of Service
              </h3>
              <button type="button" className="icon-button" aria-label="Close dialog" onClick={() => setShowTermsModal(false)}><ExternalLink size={18} /></button>
            </div>

            <div style={{ fontSize: '0.82rem', color: 'var(--color-text-charcoal)', lineHeight: '1.6', marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <p>
                <strong>1. Nature of Computational Estimates</strong><br />
                All transaction price summaries, gross rental yield metrics, and GIS livability scores are computational calculations based upon historical data. They do not constitute certified professional appraisals, financial advice, or formal property valuations under Singapore law.
              </p>
              <p>
                <strong>2. Independent Verification</strong><br />
                Users must independently verify property facts, caveats, loan requirements, and encumbrances with Singapore Land Authority (SLA) title searches and registered Council for Estate Agencies (CEA) property representatives before executing financial transactions.
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
          </AccessibleDialog>
        </div>
      )}

      {/* Singapore PDPA & Privacy Policy Modal */}
      {showPrivacyModal && (
        <div className="modal-overlay">
          <AccessibleDialog label="Privacy policy" onClose={() => setShowPrivacyModal(false)} className="modal-card" style={{ maxWidth: '640px', maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.2rem', color: 'var(--color-text-charcoal)' }}>
                <ShieldCheck size={22} color="var(--color-primary-green)" />
                Privacy Policy & Singapore PDPA Notice
              </h3>
              <button type="button" className="icon-button" aria-label="Close dialog" onClick={() => setShowPrivacyModal(false)}><ExternalLink size={18} /></button>
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
                <br />• To connect you with an independent Council for Estate Agencies (CEA) licensed real estate salesperson for transaction advisory assistance.
                {features.advisoryPartnerName && <><br />Advisory recipient: {features.advisoryPartnerName} (CEA registration {features.advisoryPartnerRegistration}).</>}
                <br />Email processor: Resend. Hosting processor: {features.hostingProcessorName || 'not appointed'}. Backup processor: {features.backupProcessorName || 'not appointed'}.
              </p>

              <p>
                <strong>4. Protection Against Telemarketing & Third Parties</strong><br />
                We do not sell, rent, trade, or distribute your personal data to mass telemarketers or external advertisers. Unconverted advisory enquiries are retained for up to 12 months. Converted advisory records are retained for up to five years from the recorded conversion date. Unconfirmed newsletter requests expire after 24 hours and are removed after 30 days; withdrawn subscriptions are anonymized after 90 days. Encrypted backups are retained for 30 days. Restores reapply subsequent withdrawals and deletions before communications resume.
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
          </AccessibleDialog>
        </div>
      )}
    </div>
  );
}
