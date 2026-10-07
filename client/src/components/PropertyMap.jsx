import React, { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Tooltip, Circle, Pane, useMapEvents, useMap } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import axios from 'axios';
import { MapPin, Navigation, Compass, Layers, Train, GraduationCap, Utensils, ShoppingBag, Trees, AlertTriangle } from 'lucide-react';
import LivabilityBadge from './LivabilityBadge';
import {selectLocation} from '../utils/searchState';
import {mapSearchKey,propertyPresentation,regionLegend,yieldLegend} from '../utils/mapPresentation';

// Custom Map Marker Icons using SVG Data URIs
function createCustomIcon(color, isApproximate = false) {
  const stroke = isApproximate ? '#D97706' : '#ffffff';
  const strokeDash = isApproximate ? 'stroke-dasharray="2,2"' : '';
  const innerDot = isApproximate
    ? '<circle cx="12" cy="10" r="4" fill="#D97706"/><circle cx="12" cy="10" r="2" fill="#ffffff"/>'
    : '<circle cx="12" cy="10" r="3" fill="#ffffff"/>';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 24 24" fill="${color}" stroke="${stroke}" stroke-width="1.8" ${strokeDash} stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" opacity="${isApproximate ? '0.85' : '1'}"/><g>${innerDot}</g></svg>`;
  return L.icon({
    iconUrl: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`,
    iconSize: [28, 36],
    iconAnchor: [14, 36],
    popupAnchor: [0, -32]
  });
}

function createAmenityIcon(symbol, bgColor) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="${bgColor}" stroke="#ffffff" stroke-width="2"/><text x="12" y="16" font-size="12" text-anchor="middle" fill="#ffffff">${symbol}</text></svg>`;
  return L.icon({
    iconUrl: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -12]
  });
}

const mrtIcon = createAmenityIcon('🚆', '#10B981');
const schoolIcon = createAmenityIcon('🏫', '#0EA5E9');
const hawkerIcon = createAmenityIcon('🍜', '#F97316');
const supermarketIcon = createAmenityIcon('🛒', '#D97706');
const parkIcon = createAmenityIcon('🌳', '#059669');

// Dynamic Map Controller Component to Fly/Pan Map to Selected Search Locations
function MapViewController({ centerCoords, mapProjects, filters, loadedSearchKey }) {
  const map = useMap();
  const lastSearch=useRef(null);

  useEffect(() => {
    const searchKey=mapSearchKey(filters);
    if(loadedSearchKey!==searchKey || lastSearch.current===searchKey) return;
    const initial=lastSearch.current===null;
    lastSearch.current=searchKey;
    // A radius click/change searches in place. A restored radius link needs an initial view.
    if(centerCoords && filters.radiusKm) {
      if(initial) map.fitBounds(L.latLng(centerCoords.lat,centerCoords.lng).toBounds(filters.radiusKm*2000),{padding:[24,24],maxZoom:16});
      return;
    }
    // 1. Explicit Center Coords Selected
    if (centerCoords && centerCoords.lat && centerCoords.lng) {
      map.flyTo([centerCoords.lat, centerCoords.lng], 15, { animate: true, duration: 1.2 });
      return;
    }

    // 2. Auto-fit bounds/center when location filters (project, street, district, planning area) update
    const hasFilter = (filters.projects && filters.projects.length > 0) || filters.street || filters.district || filters.planningArea;
    if (hasFilter && mapProjects && mapProjects.length > 0) {
      const validProjects = mapProjects.filter(p => p && !isNaN(parseFloat(p.lat)) && !isNaN(parseFloat(p.lng)));
      if (validProjects.length === 1) {
        map.flyTo([parseFloat(validProjects[0].lat), parseFloat(validProjects[0].lng)], 16, { animate: true, duration: 1.2 });
      } else if (validProjects.length > 1) {
        const bounds = L.latLngBounds(validProjects.map(p => [parseFloat(p.lat), parseFloat(p.lng)]));
        if (bounds.isValid()) {
          map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16, animate: true, duration: 1 });
        }
      }
    }
  }, [centerCoords, mapProjects, filters, loadedSearchKey, map]);

  return null;
}

function MapEventsHandler({ onMapClick }) {
  useMapEvents({
    click(e) {
      onMapClick(e.latlng);
    }
  });
  return null;
}

function PropertyDetails({p,viewMode,showDistanceRings,setShowDistanceRings,onClose,handleSelectProjectOnMap,onOpenLivabilityDrawer}) {
  const activeProperty=p;
  const presentation=propertyPresentation(p,viewMode),isApproximate=presentation.approximate,priceRate=p.medianPsft;
  return <section className="map-detail-panel" role="region" aria-label="Property details">
    <div className="map-detail-header"><strong>Property details</strong><button type="button" className="icon-button" aria-label="Close property details" onClick={onClose}>×</button></div>
                    <div style={{ padding: '4px', maxWidth: '240px' }}>
                      <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--color-text-charcoal)', marginBottom: '4px' }}>
                        {p.name}
                      </div>

                      {isApproximate && (
                        <div style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          background: '#FEF3C7',
                          color: '#B45309',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          fontSize: '0.72rem',
                          fontWeight: 700,
                          marginBottom: '6px'
                        }}>
                          <AlertTriangle size={11} color="#B45309" />
                          Approximate (District Centroid)
                        </div>
                      )}

                      <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', marginBottom: '6px' }}>
                        {p.street} • District {p.district} ({p.segment})
                      </div>

                      {viewMode === 'rental' ? (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', background: '#FFFBEB', padding: '6px 8px', borderRadius: '6px', border: '1px solid #FCD34D' }}>
                          <div>
                            <div style={{ fontSize: '0.7rem', color: '#92400E', fontWeight: 600 }}>Median Rent</div>
                            <div style={{ fontWeight: 700, color: 'var(--color-primary-green)', fontSize: '0.85rem' }}>
                              {p.medianRent == null ? 'N/A' : `$${p.medianRent.toLocaleString()} /mo`}
                            </div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '0.7rem', color: '#92400E', fontWeight: 600 }}>Gross Yield (Median Inputs)</div>
                            <div style={{ fontWeight: 800, color: p.grossYield >= 4.25 ? '#10B981' : p.grossYield >= 3.25 ? '#D97706' : '#CB6D51', fontSize: '0.85rem' }}>
                              {p.grossYield ? `${p.grossYield}%` : 'N/A'}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', background: '#F8FAFC', padding: '6px 8px', borderRadius: '6px' }}>
                          <div>
                            <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>Median Rate</div>
                            <div style={{ fontWeight: 700, color: 'var(--color-primary-green)', fontSize: '0.85rem' }}>
                              {priceRate == null ? 'N/A' : `$${priceRate.toLocaleString()} /sqft`}
                            </div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>Transactions</div>
                            <div style={{ fontWeight: 700, color: 'var(--color-text-charcoal)', fontSize: '0.85rem' }}>
                              {p.txCount || 0}
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="map-popup-actions">
                        <button type="button" className="btn" onClick={()=>handleSelectProjectOnMap(p.name)}>Show only this development</button>
                        {!isApproximate ? <button type="button" className="btn" aria-pressed={showDistanceRings && activeProperty?.id===p.id}
                          onClick={()=>setShowDistanceRings(value=>!value)}>{showDistanceRings && activeProperty?.id===p.id ? 'Hide distance rings' : 'Show distance rings'}</button>
                          : <p>Distance rings are unavailable for approximate locations.</p>}
                      </div>
                      {/* Livability Badge */}
                      {p.livability && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px' }}>
                          <LivabilityBadge
                            livability={p.livability}
                            size="small"
                            onClick={() => onOpenLivabilityDrawer({ project: p, livability: p.livability })}
                          />
                          <button
                            onClick={() => onOpenLivabilityDrawer({ project: p, livability: p.livability })}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: 'var(--color-primary-green)',
                              fontWeight: 600,
                              fontSize: '0.75rem',
                              cursor: 'pointer',
                              textDecoration: 'underline'
                            }}
                          >
                            View Details
                          </button>
                        </div>
                      )}
                    </div>
    {showDistanceRings && <p className="map-distance-key"><span style={{color:'#047857'}}>Green: 400 m</span> · <span style={{color:'#0369A1'}}>Blue: 800 m</span><br/>Straight-line distances, not walking routes.</p>}
  </section>;
}
export default function PropertyMap({ mapProjects, loadedSearchKey, filters, setFilters, unitType, viewMode = 'sale', onOpenLivabilityDrawer }) {
  const [selectedRadius, setSelectedRadius] = useState(filters.radiusKm || 1.5);
  const [amenities, setAmenities] = useState([]);
  const [activeProperty, setActiveProperty] = useState(null);
  const [showDistanceRings, setShowDistanceRings] = useState(false);
  const mapRef=useRef(null);
  const filterKey=JSON.stringify({...filters,page:undefined});
  useEffect(()=>{mapRef.current?.closePopup();setActiveProperty(null);setShowDistanceRings(false);},[filterKey,viewMode]);
  useEffect(()=>{if(filters.radiusKm!=null)setSelectedRadius(filters.radiusKm);},[filters.radiusKm]);
  const [amenityToggles, setAmenityToggles] = useState({
    mrt: false,
    school: false,
    hawker: false,
    supermarket: false,
    park: false
  });
  const [basemapStyle, setBasemapStyle] = useState('Default');

  // Default map center: Singapore Keppel / Central (1.2850, 103.8200)
  const defaultCenter = [1.2850, 103.8200];

  useEffect(() => {
    async function loadAmenities() {
      try {
        const res = await axios.get('/api/amenities');
        setAmenities(res.data || []);
      } catch (err) {
        console.error('Failed to load amenities for map:', err);
      }
    }
    loadAmenities();
  }, []);

  const handleMapClick = (latlng) => {
    setActiveProperty(null);setShowDistanceRings(false);
    setFilters(prev => selectLocation(prev, {
      radiusKm: selectedRadius,
      centerCoords: { lat: latlng.lat, lng: latlng.lng }
    }));
  };

  const handleSelectProjectOnMap = (projName) => {
    setActiveProperty(null);setShowDistanceRings(false);
    setFilters(prev => selectLocation(prev, {
      projects: [projName]
    }));
  };

  const toggleAmenityLayer = (cat) => {
    setAmenityToggles(prev => ({ ...prev, [cat]: !prev[cat] }));
  };

  return (
    <div className="card">
      <div className="card-header" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '10px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 className="card-title">
            <Navigation size={18} color={viewMode === 'rental' ? 'var(--color-primary-terracotta)' : 'var(--color-primary-green)'} />
            Property map
          </h3>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Radius: {selectedRadius} km</span>
            <input
              aria-label="Map search radius"
              type="range"
              min="0.5"
              max="5"
              step="0.5"
              value={selectedRadius}
              onChange={e => {
                const val = parseFloat(e.target.value);
                setSelectedRadius(val);
                if (filters.centerCoords && filters.radiusKm) {
                  setFilters(prev => ({ ...prev, radiusKm: val }));
                }
              }}
              style={{ width: '80px', accentColor: 'var(--color-primary-green)' }}
            />
          </div>
        </div>

        {/* GIS Amenity Layer Toggles */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', background: '#F8FAFC', padding: '8px 12px', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Layers size={13} /> Amenity Layers:
          </span>

          <button
            aria-pressed={amenityToggles.mrt}
            onClick={() => toggleAmenityLayer('mrt')}
            style={{
              padding: '4px 10px',
              borderRadius: '16px',
              border: '1px solid #10B981',
              background: amenityToggles.mrt ? '#10B98115' : '#FFFFFF',
              color: '#065F46',
              fontSize: '0.75rem',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <Train size={12} color="#10B981" /> MRTs
          </button>

          <button
            aria-pressed={amenityToggles.school}
            onClick={() => toggleAmenityLayer('school')}
            style={{
              padding: '4px 10px',
              borderRadius: '16px',
              border: '1px solid #0EA5E9',
              background: amenityToggles.school ? '#0EA5E915' : '#FFFFFF',
              color: '#0369A1',
              fontSize: '0.75rem',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <GraduationCap size={12} color="#0EA5E9" /> Schools
          </button>

          <button
            aria-pressed={amenityToggles.hawker}
            onClick={() => toggleAmenityLayer('hawker')}
            style={{
              padding: '4px 10px',
              borderRadius: '16px',
              border: '1px solid #F97316',
              background: amenityToggles.hawker ? '#F9731615' : '#FFFFFF',
              color: '#C2410C',
              fontSize: '0.75rem',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <Utensils size={12} color="#F97316" /> Hawkers
          </button>

          <button
            aria-pressed={amenityToggles.supermarket}
            onClick={() => toggleAmenityLayer('supermarket')}
            style={{
              padding: '4px 10px',
              borderRadius: '16px',
              border: '1px solid #D97706',
              background: amenityToggles.supermarket ? '#D9770615' : '#FFFFFF',
              color: '#92400E',
              fontSize: '0.75rem',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <ShoppingBag size={12} color="#D97706" /> Supermarkets
          </button>

          <button
            aria-pressed={amenityToggles.park}
            onClick={() => toggleAmenityLayer('park')}
            style={{
              padding: '4px 10px',
              borderRadius: '16px',
              border: '1px solid #059669',
              background: amenityToggles.park ? '#05966915' : '#FFFFFF',
              color: '#065F46',
              fontSize: '0.75rem',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <Trees size={12} color="#059669" /> Parks
          </button>

          {/* SLA OneMap Basemap Style Selector */}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>Map Style:</span>
            <select
              aria-label="Map style"
              value={basemapStyle}
              onChange={e => setBasemapStyle(e.target.value)}
              style={{
                padding: '4px 8px',
                borderRadius: '6px',
                border: '1px solid #CBD5E1',
                fontSize: '0.75rem',
                fontWeight: 600,
                background: '#FFFFFF',
                color: '#334155',
                cursor: 'pointer'
              }}
            >
              <option value="Default">SLA OneMap (Default)</option>
              <option value="Grey">SLA OneMap (Grey)</option>
              <option value="Night">SLA OneMap (Night)</option>
              <option value="Original">SLA OneMap (Original)</option>
            </select>
          </div>
        </div>
      </div>

      <div className="map-guide">
        <p>Click an empty spot to search nearby. Hover over a pin for its name, or tap it for details.</p>
        <p><span className="map-cluster-example">12</span> Numbered circles group developments. Click to zoom in and reveal the pins.</p>
        <div className="map-legend" aria-label={viewMode==='rental'?'Rental yield pin legend':'Market region pin legend'}>
          <strong>Property pins:</strong>
          {(viewMode==='rental'?yieldLegend:regionLegend).map(item=><span key={item.label}><i style={{background:item.color}}/>{item.label}</span>)}
        </div>
        <p>Amber dotted pins mark approximate district locations, not exact buildings. Amenities start hidden; use the layer buttons above to add them.</p>
        {filters.radiusKm && filters.centerCoords && <div className="map-search-summary">
          <span>Dashed green circle: your {filters.radiusKm} km search area.</span>
          <button type="button" className="btn" onClick={()=>setFilters(prev=>({...prev,radiusKm:null,centerCoords:null}))}>Clear map search</button>
        </div>}
      </div>
      <div style={{ position:'relative', height: '500px', width: '100%', borderRadius: '0 0 12px 12px', overflow: 'hidden' }}>
        {activeProperty && <PropertyDetails p={activeProperty} viewMode={viewMode} showDistanceRings={showDistanceRings}
          setShowDistanceRings={setShowDistanceRings} handleSelectProjectOnMap={handleSelectProjectOnMap}
          onOpenLivabilityDrawer={onOpenLivabilityDrawer} onClose={()=>{setActiveProperty(null);setShowDistanceRings(false);}}/>}
        <MapContainer
          ref={mapRef}
          center={defaultCenter}
          zoom={12}
          minZoom={11}
          maxZoom={19}
          maxBounds={[[1.13, 103.55], [1.48, 104.10]]}
          maxBoundsViscosity={0.8}
          style={{ height: '100%', width: '100%' }}
          scrollWheelZoom={true}
        >
          <TileLayer
            key={basemapStyle}
            attribution='&copy; <a href="https://www.onemap.gov.sg/" target="_blank" rel="noopener noreferrer">OneMap</a> &copy; Singapore Land Authority'
            url={`https://www.onemap.gov.sg/maps/tiles/${basemapStyle}/{z}/{x}/{y}.png`}
            minZoom={11}
            maxZoom={19}
          />

          <MapEventsHandler onMapClick={handleMapClick} />
          <MapViewController centerCoords={filters.centerCoords} mapProjects={mapProjects} filters={filters} loadedSearchKey={loadedSearchKey} />

          {/* Render Radius Circle if Active */}
          {filters.centerCoords && filters.radiusKm && (
            <Circle
              interactive={false}
              className="map-search-ring"
              center={[filters.centerCoords.lat, filters.centerCoords.lng]}
              radius={filters.radiusKm * 1000}
              pathOptions={{
                color: '#4F7942',
                fillColor: '#4F7942',
                fillOpacity: 0.12,
                dashArray: '6, 6'
              }}
            />
          )}

          {/* Render Active Property Walk Radius Rings (400m & 800m) */}
          {activeProperty && showDistanceRings && !propertyPresentation(activeProperty,viewMode).approximate && (
            (() => {
              const actLat = parseFloat(activeProperty.lat);
              const actLng = parseFloat(activeProperty.lng);
              if (isNaN(actLat) || isNaN(actLng)) return null;
              return (
                <>
                  {/* 400m / 5-min Walk */}
                  <Circle
                    interactive={false}
                    className="map-distance-ring"
                    center={[actLat, actLng]}
                    radius={400}
                    pathOptions={{ color: '#10B981', fillColor: '#10B981', fillOpacity: 0.15, weight: 1.5 }}
                  />
                  {/* 800m / 10-min Walk */}
                  <Circle
                    interactive={false}
                    className="map-distance-ring"
                    center={[actLat, actLng]}
                    radius={800}
                    pathOptions={{ color: '#0EA5E9', fillColor: '#0EA5E9', fillOpacity: 0.08, weight: 1.5, dashArray: '4, 4' }}
                  />
                </>
              );
            })()
          )}

          {/* Development Property Markers with MarkerClusterGroup for smooth clustering (Step 4.1) */}
          <Pane name="property-pins" style={{zIndex:620}}>
          <MarkerClusterGroup chunkedLoading maxClusterRadius={50} showCoverageOnHover={false} clusterPane="property-pins"
            iconCreateFunction={cluster=>L.divIcon({className:'property-cluster',html:`<span title="${cluster.getChildCount()} developments; click to zoom" aria-label="${cluster.getChildCount()} developments grouped here; click to zoom">${cluster.getChildCount()}</span>`,iconSize:[40,40],iconAnchor:[20,20]})}
            onMouseOver={event=>event.layer.bindTooltip(`${event.layer.getChildCount()} developments grouped here. Click to zoom in.`,{direction:'top'}).openTooltip()}
            onMouseOut={event=>event.layer.closeTooltip()}>
            {mapProjects && mapProjects.length > 0 && mapProjects.map((p) => {
              const pLat = parseFloat(p.lat);
              const pLng = parseFloat(p.lng);
              if (isNaN(pLat) || isNaN(pLng)) return null;

              const presentation=propertyPresentation(p,viewMode);
              const isApproximate=presentation.approximate;
              const icon=createCustomIcon(presentation.color,isApproximate);
              const priceRate = p.medianPsft;

              return (
                <Marker
                  key={p.id}
                  position={[pLat, pLng]}
                  icon={icon}
                  pane="property-pins"
                  title={`${p.name} · ${p.street || ''}`}
                  alt={`${p.name} property details`}
                  bubblingMouseEvents={false}
                  eventHandlers={{
                    click:()=>{mapRef.current?.closePopup();setActiveProperty(p);setShowDistanceRings(false);}
                  }}
                >
                  <Tooltip direction="top" offset={[0,-28]}>
                    <strong>{p.name}</strong><br/>{p.street} · {presentation.label}
                    {isApproximate && <><br/>Approximate district location</>}
                  </Tooltip>

                </Marker>
              );
            })}
          </MarkerClusterGroup>
          </Pane>

          {/* GIS Amenity POI Markers */}
          {amenities && amenities.length > 0 && amenities.map((a, idx) => {
            if (!amenityToggles[a.category]) return null;
            const aLat = parseFloat(a.lat || a.latitude);
            const aLng = parseFloat(a.lng || a.longitude);
            if (isNaN(aLat) || isNaN(aLng)) return null;

            let icon = mrtIcon;
            if (a.category === 'school') icon = schoolIcon;
            else if (a.category === 'hawker') icon = hawkerIcon;
            else if (a.category === 'supermarket') icon = supermarketIcon;
            else if (a.category === 'park') icon = parkIcon;

            return (
              <Marker key={`amenity-${a.id || a.amenity_id || idx}`} position={[aLat, aLng]} icon={icon}
                title={`${a.name} · ${a.category}`} alt={`${a.name} amenity details`} bubblingMouseEvents={false}
                eventHandlers={{click:()=>{setActiveProperty(null);setShowDistanceRings(false);}}}>
                <Tooltip direction="top" offset={[0,-10]}><strong>{a.name}</strong><br/>{a.category==='mrt'?'MRT station':a.category==='hawker'?'Hawker centre':a.category==='supermarket'?'Supermarket':a.category==='school'?'School':'Park'}</Tooltip>
                <Popup autoPan={false} maxHeight={220}>
                  <div style={{ padding: '4px', maxWidth: '220px' }}>
                    <div style={{ fontWeight: 700, color: 'var(--color-text-charcoal)', fontSize: '0.88rem', marginBottom: '2px' }}>{a.name}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-primary-green)', fontWeight: 600, textTransform: 'capitalize', marginBottom: '4px' }}>
                      {a.category} {a.details?.type ? `• ${a.details.type}` : ''}
                    </div>
                    {a.details?.address && (
                      <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginBottom: '3px' }}>
                        {a.details.address}
                      </div>
                    )}
                    {a.details?.famousFor && (
                      <div style={{ fontSize: '0.72rem', color: '#B45309', background: '#FEF3C7', padding: '3px 6px', borderRadius: '4px', marginTop: '4px' }}>
                        ✨ {a.details.famousFor}
                      </div>
                    )}
                    {a.details?.stalls && (
                      <div style={{ fontSize: '0.72rem', color: '#047857', background: '#D1FAE5', padding: '2px 6px', borderRadius: '4px', marginTop: '4px', display: 'inline-block' }}>
                        🍲 {a.details.stalls} Food Stalls
                      </div>
                    )}
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>
      </div>

      <div style={{ padding: '8px 16px', background: '#F8FAFC', borderTop: '1px solid #E2E8F0', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
        Inspecting a pin keeps your search and map position. Use “Show only this development” to filter the dashboard. Distance rings are optional and show straight-line distances.
      </div>
    </div>
  );
}
