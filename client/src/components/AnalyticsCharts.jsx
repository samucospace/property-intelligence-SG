import React, { useState } from 'react';
import {
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  ZAxis
} from 'recharts';
import { TrendingUp, Layers, BarChart2, Percent } from 'lucide-react';

const CustomTooltip = ({ active, payload, label, unitType, show1mSora, show3mSora }) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    const hasTransactions = data.volume > 0;
    return (
      <div style={{
        background: '#FFFFFF',
        border: '1px solid rgba(54, 69, 79, 0.15)',
        padding: '12px 16px',
        borderRadius: '10px',
        boxShadow: '0 8px 24px rgba(54, 69, 79, 0.12)',
        fontSize: '0.85rem',
        color: '#36454F'
      }}>
        <div style={{ fontWeight: 700, marginBottom: '6px', color: '#36454F', fontFamily: 'var(--font-heading)' }}>{label}</div>
        {hasTransactions ? (
          <>
            <div style={{ color: '#00B080', margin: '3px 0' }}>
              Median Rate: <strong>${(unitType === 'sqm' ? data.medianPsqm : data.medianPsft)?.toLocaleString()}</strong> /{unitType}
            </div>
            <div style={{ color: '#4F7942', margin: '3px 0' }}>
              Median Price: <strong>${data.medianPrice?.toLocaleString()} SGD</strong>
            </div>
            <div style={{ color: '#CB6D51', margin: '3px 0' }}>
              Sales Volume: <strong>{data.volume} {data.volume === 1 ? 'transaction' : 'transactions'}</strong>
            </div>
          </>
        ) : (
          <div style={{ color: '#6A7B82', margin: '4px 0', fontSize: '0.82rem', fontStyle: 'italic' }}>
            No transaction caveats in this period
          </div>
        )}
        {show1mSora && data.sora1m != null && (
          <div style={{ color: '#7C3AED', margin: '3px 0' }}>
            1M Compounded SORA: <strong>{data.sora1m}%</strong>
          </div>
        )}
        {show3mSora && data.sora3m != null && (
          <div style={{ color: '#DB2777', margin: '3px 0' }}>
            3M Compounded SORA: <strong>{data.sora3m}%</strong>
          </div>
        )}
      </div>
    );
  }
  return null;
};

export default function AnalyticsCharts({ timeSeries = [], scatterPoints = [], bedroomBreakdown = [], unitType = 'sqm', viewMode = 'sale' }) {
  const [activeTab, setActiveTab] = useState('trend');
  const [show1mSora, setShow1mSora] = useState(true);
  const [show3mSora, setShow3mSora] = useState(true);

  if (viewMode === 'rental') {
    return (
      <div className="card">
        <div className="card-header" style={{ flexWrap: 'wrap', gap: '12px' }}>
          <h3 className="card-title">
            <TrendingUp size={18} color="var(--color-primary-terracotta)" />
            Rental Rate & Gross Yield Breakdown Analytics
          </h3>

          <div className="tab-buttons">
            <button
              className={`tab-btn ${activeTab === 'trend' ? 'active' : ''}`}
              onClick={() => setActiveTab('trend')}
            >
              <TrendingUp size={14} /> Rental Price Trend
            </button>
            <button
              className={`tab-btn ${activeTab === 'bedroom' ? 'active' : ''}`}
              onClick={() => setActiveTab('bedroom')}
            >
              <Layers size={14} /> Bedroom Yield Breakdown
            </button>
          </div>
        </div>

        <div style={{ height: '380px', width: '100%', padding: '16px 8px 8px 8px' }}>
          {activeTab === 'trend' ? (
            timeSeries.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={timeSeries} margin={{ top: 10, right: 30, left: 10, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 11, fill: '#64748B' }}
                    tickLine={true}
                    interval="preserveStartEnd"
                    minTickGap={25}
                    dy={8}
                  />
                  <YAxis yAxisId="left" tick={{ fontSize: 11, fill: '#64748B' }} unit=" $" />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: '#64748B' }} />
                  <Tooltip
                    formatter={(value, name) => {
                      if (value == null) return ['N/A', name === 'avgRent' ? 'Average Rent' : name];
                      if (name === 'avgRent') return [`$${value.toLocaleString()} /mo`, 'Average Rent'];
                      if (name === 'avgRentPsft') return [`$${value} /sqft/mo`, 'Rent Rate'];
                      if (name === 'count') return [`${value} leases`, 'Lease Volume'];
                      return [value, name];
                    }}
                  />
                  <Legend wrapperStyle={{ paddingTop: '10px' }} />
                  <Bar yAxisId="right" dataKey="count" name="Lease Volume" fill="#CBD5E1" opacity={0.5} barSize={16} radius={[4, 4, 0, 0]} />
                  <Line yAxisId="left" type="monotone" dataKey="avgRent" name="Avg Monthly Rent ($)" stroke="#CB6D51" strokeWidth={3} connectNulls={true} dot={{ r: 3, fill: '#CB6D51' }} />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ display: 'flex', height: '100%', justifyContent: 'center', alignItems: 'center', color: 'var(--color-text-muted)' }}>
                No rental trend data matching current filters.
              </div>
            )
          ) : (
            bedroomBreakdown.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={bedroomBreakdown} margin={{ top: 10, right: 30, left: 10, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
                  <XAxis dataKey="bedroom" tick={{ fontSize: 12, fill: '#334155', fontWeight: 600 }} dy={8} />
                  <YAxis yAxisId="left" tick={{ fontSize: 11, fill: '#10B981' }} unit="%" domain={[0, 8]} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: '#0EA5E9' }} unit=" $" />
                  <Tooltip
                    formatter={(value, name) => {
                      if (name === 'avgYield') return [`${value}%`, 'Gross Yield'];
                      if (name === 'avgRent') return [`$${value.toLocaleString()} /mo`, 'Avg Monthly Rent'];
                      if (name === 'count') return [`${value} leases`, 'Recorded Leases'];
                      return [value, name];
                    }}
                  />
                  <Legend wrapperStyle={{ paddingTop: '10px' }} />
                  <Bar yAxisId="left" dataKey="avgYield" name="Gross Yield (%)" fill="#10B981" barSize={32} radius={[6, 6, 0, 0]} />
                  <Line yAxisId="right" type="monotone" dataKey="avgRent" name="Avg Rent ($/mo)" stroke="#0EA5E9" strokeWidth={3} dot={{ r: 4 }} />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ display: 'flex', height: '100%', justifyContent: 'center', alignItems: 'center', color: 'var(--color-text-muted)' }}>
                No bedroom breakdown data matching current filters.
              </div>
            )
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-header" style={{ flexWrap: 'wrap', gap: '12px' }}>
        <h3 className="card-title">
          <TrendingUp size={18} color="var(--color-primary-green)" />
          Property Valuation & Interest Rate Analytics
        </h3>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          {activeTab === 'trend' && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              background: 'var(--color-bg-sand)',
              padding: '5px 12px',
              borderRadius: '8px',
              border: '1px solid var(--color-border-subtle)',
              fontSize: '0.78rem'
            }}>
              <span style={{ color: 'var(--color-text-muted)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Percent size={13} color="#7C3AED" /> SORA Overlay:
              </span>
              <label style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer', color: '#7C3AED', userSelect: 'none', fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={show1mSora}
                  onChange={(e) => setShow1mSora(e.target.checked)}
                  style={{ accentColor: '#7C3AED', cursor: 'pointer' }}
                />
                <span>1M SORA</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer', color: '#DB2777', userSelect: 'none', fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={show3mSora}
                  onChange={(e) => setShow3mSora(e.target.checked)}
                  style={{ accentColor: '#DB2777', cursor: 'pointer' }}
                />
                <span>3M SORA</span>
              </label>
            </div>
          )}

          <div className="tab-buttons">
            <button
              className={`tab-btn ${activeTab === 'trend' ? 'active' : ''}`}
              onClick={() => setActiveTab('trend')}
            >
              <BarChart2 size={13} style={{ display: 'inline', marginRight: '4px' }} /> Price & SORA Trend
            </button>
            <button
              className={`tab-btn ${activeTab === 'floor' ? 'active' : ''}`}
              onClick={() => setActiveTab('floor')}
            >
              <Layers size={13} style={{ display: 'inline', marginRight: '4px' }} /> Floor Tier Distribution
            </button>
          </div>
        </div>
      </div>

      <div style={{ height: '420px', width: '100%', marginTop: '12px' }}>
        {activeTab === 'trend' ? (
          timeSeries && timeSeries.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={timeSeries} margin={{ top: 10, right: 15, left: 10, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(54, 69, 79, 0.08)" />
                <XAxis
                  dataKey="period"
                  stroke="#6A7B82"
                  fontSize={11}
                  tickLine={true}
                  interval="preserveStartEnd"
                  minTickGap={25}
                />
                
                {/* Left Y-Axis: Rate ($/sqm or $/sqft) */}
                <YAxis
                  yAxisId="left"
                  orientation="left"
                  stroke="#00B080"
                  fontSize={11}
                  tickFormatter={val => `$${val.toLocaleString()}`}
                  domain={['auto', 'auto']}
                />
                
                {/* Right Y-Axis: Volume */}
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  stroke="#CB6D51"
                  fontSize={11}
                  domain={[0, 'auto']}
                />

                {/* Secondary Right Y-Axis: SORA Interest Rate (%) */}
                {(show1mSora || show3mSora) && (
                  <YAxis
                    yAxisId="sora"
                    orientation="right"
                    stroke="#7C3AED"
                    fontSize={11}
                    tickFormatter={val => `${val}%`}
                    domain={[0, 5]}
                    dx={28}
                  />
                )}

                <Tooltip content={<CustomTooltip unitType={unitType} show1mSora={show1mSora} show3mSora={show3mSora} />} />
                <Legend wrapperStyle={{ paddingTop: '10px', fontSize: '0.8rem', fontFamily: 'var(--font-heading)' }} />

                <Bar
                  yAxisId="right"
                  dataKey="volume"
                  name="Transaction Volume"
                  fill="#CB6D51"
                  opacity={0.4}
                  barSize={18}
                  radius={[4, 4, 0, 0]}
                />

                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey={unitType === 'sqm' ? 'medianPsqm' : 'medianPsft'}
                  name={`Median Rate ($/${unitType.toUpperCase()})`}
                  stroke="#00B080"
                  strokeWidth={3}
                  connectNulls={true}
                  dot={{ r: 4, fill: '#00B080' }}
                  activeDot={{ r: 7 }}
                />

                {show1mSora && (
                  <Line
                    yAxisId="sora"
                    type="monotone"
                    dataKey="sora1m"
                    name="1-Month SORA (1M SORA %)"
                    stroke="#7C3AED"
                    strokeWidth={2}
                    strokeDasharray="4 4"
                    connectNulls={true}
                    dot={{ r: 3, fill: '#7C3AED' }}
                    activeDot={{ r: 6 }}
                  />
                )}

                {show3mSora && (
                  <Line
                    yAxisId="sora"
                    type="monotone"
                    dataKey="sora3m"
                    name="3-Month SORA (3M SORA %)"
                    stroke="#DB2777"
                    strokeWidth={2.5}
                    connectNulls={true}
                    dot={{ r: 3, fill: '#DB2777' }}
                    activeDot={{ r: 6 }}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--color-text-muted)' }}>
              No transaction history matching current filters.
            </div>
          )
        ) : (
          scatterPoints && scatterPoints.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 10, right: 10, left: 10, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(54, 69, 79, 0.08)" />
                <XAxis dataKey="floorRange" type="category" stroke="#6A7B82" fontSize={11} name="Floor Range" />
                <YAxis
                  dataKey={unitType === 'sqm' ? 'psqm' : 'psft'}
                  stroke="#4F7942"
                  fontSize={11}
                  tickFormatter={val => `$${val.toLocaleString()}`}
                  name={`Rate ($/${unitType.toUpperCase()})`}
                />
                <ZAxis dataKey="priceSgd" range={[40, 300]} name="Total Price" />
                <Tooltip cursor={{ strokeDasharray: '3 3' }} content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const data = payload[0].payload;
                    return (
                      <div style={{
                        background: '#FFFFFF',
                        border: '1px solid rgba(54, 69, 79, 0.15)',
                        padding: '10px 14px',
                        borderRadius: '8px',
                        boxShadow: '0 8px 24px rgba(54, 69, 79, 0.12)',
                        fontSize: '0.8rem',
                        color: '#36454F'
                      }}>
                        <div style={{ fontWeight: 700, color: '#36454F', fontFamily: 'var(--font-heading)' }}>{data.projectName}</div>
                        <div style={{ color: '#6A7B82' }}>Floor: {data.floorRange} • {data.typeOfSale}</div>
                        <div>Rate: <strong style={{ color: '#00B080' }}>${(unitType === 'sqm' ? data.psqm : data.psft)?.toLocaleString()}</strong> /{unitType}</div>
                        <div>Total: <strong style={{ color: '#4F7942' }}>${data.priceSgd?.toLocaleString()} SGD</strong></div>
                        <div style={{ color: '#6A7B82' }}>Size: {data.areaSqm} sqm ({data.areaSqft} sqft)</div>
                      </div>
                    );
                  }
                  return null;
                }} />
                <Scatter name="Transactions" data={scatterPoints} fill="#4F7942" opacity={0.75} />
              </ScatterChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--color-text-muted)' }}>
              No scatter plot points available.
            </div>
          )
        )}
      </div>
    </div>
  );
}
