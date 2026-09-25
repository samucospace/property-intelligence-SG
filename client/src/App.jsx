import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Building2, Database, Key, Percent, Layers, Calendar, ExternalLink } from 'lucide-react';
import SearchHeader from './components/SearchHeader';
import PropertyMap from './components/PropertyMap';
import AnalyticsCharts from './components/AnalyticsCharts';
import UraIngestionModal from './components/UraIngestionModal';
import LivabilityBadge from './components/LivabilityBadge';
import LivabilityDrawer from './components/LivabilityDrawer';
import RentalYieldDrawer from './components/RentalYieldDrawer';

export default function App() {
  const [viewMode, setViewMode] = useState('sale'); // 'sale' or 'rental'
  const [unitType, setUnitType] = useState('sqm'); // 'sqm' or 'sqft'
  const [filters, setFilters] = useState({
    projects: [],
    street: null,
    district: null,
    planningArea: null,
    bedroomCount: 'all',
    radiusKm: null,
    centerCoords: null,
    dateFrom: '2021-01-01',
    dateTo: '2026-12-31',
    unitSizeMin: 0,
    unitSizeMax: 10000
  });

  const [analyticsData, setAnalyticsData] = useState({
    summary: { totalVolume: 0, medianPrice: 0, medianPsqm: 0, medianPsft: 0, minPrice: 0, maxPrice: 0 },
    timeSeries: [],
    scatterPoints: [],
    bedroomBreakdown: [],
    rentalCaveats: [],
    mapProjects: []
  });

  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Livability & Rental Detail Drawer states
  const [selectedDrawerProject, setSelectedDrawerProject] = useState(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [selectedRentalProject, setSelectedRentalProject] = useState(null);
  const [isRentalDrawerOpen, setIsRentalDrawerOpen] = useState(false);

  const handleOpenLivabilityDrawer = async (projData) => {
    if (projData && projData.project && projData.livability) {
      setSelectedDrawerProject(projData);
      setIsDrawerOpen(true);
    } else if (projData && projData.projectId) {
      try {
        const res = await axios.get(`/api/projects/${projData.projectId}/livability`);
        setSelectedDrawerProject(res.data);
        setIsDrawerOpen(true);
      } catch (err) {
        console.error('Error fetching project livability:', err);
      }
    }
  };

  const fetchAnalytics = useCallback(async () => {
    setLoading(true);
    try {
      const endpoint = viewMode === 'rental' ? '/api/analytics/rental-yields' : '/api/analytics/price-trends';
      const res = await axios.post(endpoint, {
        filters: {
          ...filters,
          unitType
        }
      });
      setAnalyticsData(res.data);
    } catch (err) {
      console.error(`Error loading ${viewMode} property analytics:`, err);
    } finally {
      setLoading(false);
    }
  }, [filters, unitType, viewMode]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  const summary = analyticsData.summary || {};
  const currentMedianRate = unitType === 'sqm' ? summary.medianPsqm : summary.medianPsft;

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
          <div>
            <div className="brand-title">Habitat Real Estate Engine</div>
            <div className="brand-sub">Singapore Property Valuation, Tenancy & Livability Analytics</div>
          </div>
        </div>

        <div className="header-actions">
          {new URLSearchParams(window.location.search).get('admin') === '1' || import.meta.env.DEV ? (
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
          setUnitType={setUnitType}
          viewMode={viewMode}
          setViewMode={setViewMode}
        />

        {/* Metrics Summary Cards */}
        {viewMode === 'rental' ? (
          <div className="metrics-grid">
            <div className="metric-card terracotta">
              <span className="metric-title">Estimated Median Rent</span>
              <div className="metric-value" style={{ color: 'var(--color-primary-terracotta)' }}>
                ${summary.medianRent ? summary.medianRent.toLocaleString() : '0'} <span style={{ fontSize: '1rem', color: 'var(--color-text-muted)', fontWeight: 400 }}>/mo</span>
              </div>
              <span className="metric-sub">Based on {summary.totalLeases || 0} recorded lease agreements</span>
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
              <span className="metric-title">Median Rental Rate (${unitType.toUpperCase()})</span>
              <div className="metric-value" style={{ color: 'var(--color-accent-teal)' }}>
                ${unitType === 'sqm' ? (summary.medianRentPsqm || 0) : (summary.medianRentPsft || 0)} <span style={{ fontSize: '1rem', color: 'var(--color-text-muted)', fontWeight: 400 }}>/{unitType}/mo</span>
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
              <span className="metric-title">Estimated Median Valuation</span>
              <div className="metric-value" style={{ color: 'var(--color-primary-green)' }}>
                ${summary.medianPrice ? Math.round(summary.medianPrice).toLocaleString() : '0'} <span style={{ fontSize: '1rem', color: 'var(--color-text-muted)', fontWeight: 400 }}>SGD</span>
              </div>
              <span className="metric-sub">Based on {summary.totalVolume || 0} transactions recorded</span>
            </div>

            <div className="metric-card teal">
              <span className="metric-title">Median Unit Rate (${unitType.toUpperCase()})</span>
              <div className="metric-value" style={{ color: 'var(--color-accent-teal)' }}>
                ${currentMedianRate ? Math.round(currentMedianRate).toLocaleString() : '0'} <span style={{ fontSize: '1rem', color: 'var(--color-text-muted)', fontWeight: 400 }}>/{unitType}</span>
              </div>
              <span className="metric-sub">Equivalent: ${summary.medianPsft ? Math.round(summary.medianPsft).toLocaleString() : '0'} /sqft</span>
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
              <span className="metric-sub">Avg Sale Price: ${summary.averagePrice ? Math.round(summary.averagePrice).toLocaleString() : '0'}</span>
            </div>
          </div>
        )}

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

        {/* Detailed Caveats / Tenancy Transactions Log Table */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">
              <Layers size={18} color={viewMode === 'rental' ? 'var(--color-primary-terracotta)' : 'var(--color-primary-green)'} />
              {viewMode === 'rental' ? `Recent Tenancy Agreements Log (${analyticsData.rentalCaveats?.length || 0} Listed)` : `Recent Caveat Transactions Log (${analyticsData.scatterPoints?.length || 0} Listed)`}
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
                    analyticsData.rentalCaveats.slice(0, 150).map((r, idx) => {
                      const matchProj = mapProjList.find(p => p && (p.id === r.projectId || p.name === r.projectName));
                      const rateVal = unitType === 'sqm' ? `$${r.rentPsqm} /sqm` : `$${r.rentPsft} /sqft`;
                      const yieldColor = r.grossYield >= 4.25 ? '#10B981' : r.grossYield >= 3.25 ? '#D97706' : '#CB6D51';

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
                            <span style={{ fontWeight: 800, color: yieldColor }}>
                              {r.grossYield}%
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
                    <th>Contract Date</th>
                    <th>Sale Price (SGD)</th>
                    <th>Rate (${unitType.toUpperCase()})</th>
                    <th>Unit Size</th>
                    <th>Floor Tier</th>
                    <th>Type of Sale</th>
                  </tr>
                </thead>
                <tbody>
                  {analyticsData.scatterPoints && analyticsData.scatterPoints.length > 0 ? (
                    analyticsData.scatterPoints.slice().reverse().map((tx, idx) => {
                      const matchProj = mapProjList.find(p => p && (p.id === tx.projectId || p.name === tx.projectName));
                      const psqmVal = unitType === 'sqm' ? tx.psqm : tx.psft;
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
                            ${psqmVal ? psqmVal.toLocaleString() : '0'} /{unitType}
                          </td>
                          <td>{tx.areaSqm || 0} sqm ({tx.areaSqft || 0} sqft)</td>
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
              Property Intelligence SG
            </div>
            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
              <a href="#about" onClick={(e) => { e.preventDefault(); alert("Property Intelligence SG delivers transparent valuation, tenancy yields, and livability analytics for private properties in Singapore."); }} style={{ color: 'var(--color-text-muted)', textDecoration: 'none' }}>About</a>
              <a href="#privacy" onClick={(e) => { e.preventDefault(); alert("Privacy Policy: We do not collect personal identification numbers or confidential user financial records. Standard web analytics and cookie disclosures apply."); }} style={{ color: 'var(--color-text-muted)', textDecoration: 'none' }}>Privacy Policy</a>
              <a href="#terms" onClick={(e) => { e.preventDefault(); alert("Terms of Service: All valuation analytics and rental indices are computational estimates based on historical caveats and publicly available benchmark rates."); }} style={{ color: 'var(--color-text-muted)', textDecoration: 'none' }}>Terms of Service</a>
              <a href="https://data.gov.sg/open-data-licence" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-primary-green)', textDecoration: 'none', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                Singapore Open Data Licence <ExternalLink size={12} />
              </a>
            </div>
          </div>
          <div style={{ borderTop: '1px solid rgba(54, 69, 79, 0.08)', paddingTop: '12px', fontSize: '0.75rem', color: '#8898AA' }}>
            <p>
              <strong>Data Attribution:</strong> Singapore private residential transaction caveats and quarterly rental contracts are sourced from the <strong>Urban Redevelopment Authority (URA) Data Service</strong>, accessed under the terms of the <a href="https://data.gov.sg/open-data-licence" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>Singapore Open Data Licence</a>. Historical interest benchmark rates reflect the Singapore Overnight Rate Average (SORA) published by the Monetary Authority of Singapore (MAS). Spatial amenities and coordinates utilize SVY21 conversion derived from Singapore Land Authority (SLA) OneMap and OpenStreetMap data.
            </p>
            <p style={{ marginTop: '6px' }}>
              <strong>Disclaimer:</strong> This website is an independent analytical service and is not affiliated with, sponsored by, or endorsed by the Urban Redevelopment Authority (URA), the Singapore Land Authority (SLA), or the Government of Singapore. All property valuation indicators, rental yields, and livability indexes are computed algorithmically for research and educational purposes only.
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
        unitType={unitType}
      />

      {/* Ingestion & Seed Modal */}
      <UraIngestionModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onIngestionComplete={fetchAnalytics}
      />
    </div>
  );
}
