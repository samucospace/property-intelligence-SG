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
import { TrendingUp, Layers, BarChart2 } from 'lucide-react';

const CustomTooltip = ({ active, payload, label }) => {
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
              Median Rate: <strong>${data.medianPsft?.toLocaleString()}</strong> /sqft
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
      </div>
    );
  }
  return null;
};

export default function AnalyticsCharts({ timeSeries = [], scatterPoints = [], bedroomBreakdown = [], unitType = 'sqft', viewMode = 'sale' }) {
  const [activeTab, setActiveTab] = useState('trend');

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
                <ComposedChart data={timeSeries} margin={{ top: 10, right: 20, left: 15, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 11, fill: '#64748B' }}
                    tickLine={true}
                    interval="preserveStartEnd"
                    minTickGap={25}
                    dy={8}
                  />
                  <YAxis
                    yAxisId="left"
                    tick={{ fontSize: 11, fill: '#64748B' }}
                    tickFormatter={(val) => `$${Number(val).toLocaleString()}`}
                    width={65}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fontSize: 11, fill: '#64748B' }}
                    tickFormatter={(val) => Number(val).toLocaleString()}
                    width={45}
                  />
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
                <ComposedChart data={bedroomBreakdown} margin={{ top: 10, right: 20, left: 10, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
                  <XAxis dataKey="bedroom" tick={{ fontSize: 12, fill: '#334155', fontWeight: 600 }} dy={8} />
                  <YAxis
                    yAxisId="left"
                    tick={{ fontSize: 11, fill: '#10B981' }}
                    tickFormatter={(val) => `${val}%`}
                    domain={[0, 8]}
                    width={40}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fontSize: 11, fill: '#0EA5E9' }}
                    tickFormatter={(val) => `$${Number(val).toLocaleString()}`}
                    width={65}
                  />
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
          Property Transaction Price Analytics
        </h3>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <div className="tab-buttons">
            <button
              className={`tab-btn ${activeTab === 'trend' ? 'active' : ''}`}
              onClick={() => setActiveTab('trend')}
            >
              <BarChart2 size={13} style={{ display: 'inline', marginRight: '4px' }} /> Price Trend
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
                
                {/* Left Y-Axis: Rate ($/sqft) */}
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

                <Tooltip content={<CustomTooltip />} />
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
                  dataKey="medianPsft"
                  name="Median Rate ($/SQFT)"
                  stroke="#00B080"
                  strokeWidth={3}
                  connectNulls={true}
                  dot={{ r: 4, fill: '#00B080' }}
                  activeDot={{ r: 7 }}
                />
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
                  dataKey="psft"
                  stroke="#4F7942"
                  fontSize={11}
                  tickFormatter={val => `$${val.toLocaleString()}`}
                  name="Rate ($/SQFT)"
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
                        <div>Rate: <strong style={{ color: '#00B080' }}>${data.psft?.toLocaleString()}</strong> /sqft</div>
                        <div>Total: <strong style={{ color: '#4F7942' }}>${data.priceSgd?.toLocaleString()} SGD</strong></div>
                        <div style={{ color: '#6A7B82' }}>Size: {data.areaSqft} sqft</div>
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
