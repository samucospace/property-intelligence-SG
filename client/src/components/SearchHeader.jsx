import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { Search, X, SlidersHorizontal, MapPin, Building, Map, RefreshCw } from 'lucide-react';
import { getDefaultDateRange } from '../utils/dateUtils';

export default function SearchHeader({ filters, setFilters, unitType, setUnitType, viewMode = 'sale', setViewMode, onOpenIngestionModal }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [suggestions, setSuggestions] = useState(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef(null);

  // Debounced search suggestions fetch
  useEffect(() => {
    if (!searchTerm.trim()) {
      setSuggestions(null);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const res = await axios.get(`/api/search/suggestions?q=${encodeURIComponent(searchTerm)}`);
        setSuggestions(res.data);
        setShowDropdown(true);
      } catch (err) {
        console.error('Error fetching suggestions:', err);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Click outside to close dropdown
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelectProject = (projName) => {
    const match = suggestions?.projects?.find(p => p.name === projName);
    setFilters(prev => ({
      ...prev,
      projects: [projName],
      centerCoords: match && match.lat && match.lng ? { lat: match.lat, lng: match.lng } : null
    }));
    setSearchTerm('');
    setShowDropdown(false);
  };

  const handleSelectStreet = (streetName) => {
    setFilters(prev => ({
      ...prev,
      street: streetName,
      centerCoords: null
    }));
    setSearchTerm('');
    setShowDropdown(false);
  };

  const handleSelectDistrict = (district) => {
    setFilters(prev => ({
      ...prev,
      district: district,
      centerCoords: null
    }));
    setSearchTerm('');
    setShowDropdown(false);
  };

  const handleSelectPlanningArea = (planningArea) => {
    setFilters(prev => ({
      ...prev,
      planningArea: planningArea,
      centerCoords: null
    }));
    setSearchTerm('');
    setShowDropdown(false);
  };

  const removeProjectPill = (projName) => {
    setFilters(prev => ({
      ...prev,
      projects: prev.projects.filter(p => p !== projName)
    }));
  };

  const clearAllFilters = () => {
    const { dateFrom, dateTo } = getDefaultDateRange(5);
    setFilters({
      projects: [],
      street: null,
      district: null,
      planningArea: null,
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
    });
    setSearchTerm('');
  };

  return (
    <div className="filter-panel" ref={dropdownRef}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        {/* Module Mode Switcher */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ display: 'flex', background: '#F1F5F9', padding: '3px', borderRadius: '10px', border: '1px solid #E2E8F0' }}>
            <button
              onClick={() => setViewMode && setViewMode('sale')}
              style={{
                padding: '6px 14px',
                borderRadius: '8px',
                border: 'none',
                background: viewMode === 'sale' ? '#FFFFFF' : 'transparent',
                color: viewMode === 'sale' ? 'var(--color-primary-green)' : 'var(--color-text-muted)',
                fontWeight: 700,
                fontSize: '0.85rem',
                cursor: 'pointer',
                boxShadow: viewMode === 'sale' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                transition: 'all 0.2s ease',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              🏷️ Sale Transaction Prices & Trends
            </button>
            <button
              onClick={() => setViewMode && setViewMode('rental')}
              style={{
                padding: '6px 14px',
                borderRadius: '8px',
                border: 'none',
                background: viewMode === 'rental' ? '#FFFFFF' : 'transparent',
                color: viewMode === 'rental' ? 'var(--color-primary-terracotta)' : 'var(--color-text-muted)',
                fontWeight: 700,
                fontSize: '0.85rem',
                cursor: 'pointer',
                boxShadow: viewMode === 'rental' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                transition: 'all 0.2s ease',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              🗝️ Rental & Gross Yield (%)
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button className="btn" onClick={clearAllFilters} style={{ fontSize: '0.8rem', padding: '6px 12px' }}>
            <X size={14} /> Clear Filters
          </button>
        </div>
      </div>

      <div className="filter-grid">
        {/* Autocomplete Search Box */}
        <div className="filter-group" style={{ gridColumn: 'span 2' }}>
          <label className="filter-label">Search Development, Street, District or Planning Area</label>
          <div style={{ position: 'relative' }}>
            <input
              type="text"
              className="input-box"
              placeholder="e.g. Reflections at Keppel Bay, Keppel Bay View, District 04, Bedok..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              onFocus={() => suggestions && setShowDropdown(true)}
              style={{ paddingLeft: '36px' }}
            />
            <Search size={16} color="var(--color-text-muted)" style={{ position: 'absolute', left: '12px', top: '12px' }} />
          </div>

          {/* Suggestions Dropdown */}
          {showDropdown && suggestions && (
            <div className="autocomplete-dropdown">
              {suggestions.projects.length > 0 && (
                <>
                  <div className="dropdown-section-title">Developments</div>
                  {suggestions.projects.map(p => (
                    <div key={p.id} className="dropdown-item" onClick={() => handleSelectProject(p.name)}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>
                        <Building size={14} color="var(--color-primary-green)" />
                        {p.name}
                      </span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>D{p.district} • {p.planningArea}</span>
                    </div>
                  ))}
                </>
              )}

              {suggestions.streets.length > 0 && (
                <>
                  <div className="dropdown-section-title">Streets</div>
                  {suggestions.streets.map((s, idx) => (
                    <div key={idx} className="dropdown-item" onClick={() => handleSelectStreet(s)}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <MapPin size={14} color="var(--color-accent-teal)" />
                        {s}
                      </span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Street</span>
                    </div>
                  ))}
                </>
              )}

              {suggestions.districts.length > 0 && (
                <>
                  <div className="dropdown-section-title">Postal Districts</div>
                  {suggestions.districts.map((d, idx) => (
                    <div key={idx} className="dropdown-item" onClick={() => handleSelectDistrict(d)}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Map size={14} color="var(--color-primary-terracotta)" />
                        District {d}
                      </span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Postal District</span>
                    </div>
                  ))}
                </>
              )}

              {suggestions.planningAreas.length > 0 && (
                <>
                  <div className="dropdown-section-title">Planning Areas</div>
                  {suggestions.planningAreas.map((pa, idx) => (
                    <div key={idx} className="dropdown-item" onClick={() => handleSelectPlanningArea(pa)}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <MapPin size={14} color="var(--color-primary-green)" />
                        {pa}
                      </span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Planning Area</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>

        {/* Date From */}
        <div className="filter-group">
          <label className="filter-label">Transaction Date From</label>
          <input
            type="date"
            className="input-box"
            value={filters.dateFrom}
            onChange={e => setFilters(prev => ({ ...prev, dateFrom: e.target.value }))}
          />
        </div>

        {/* Date To */}
        <div className="filter-group">
          <label className="filter-label">Transaction Date To</label>
          <input
            type="date"
            className="input-box"
            value={filters.dateTo}
            onChange={e => setFilters(prev => ({ ...prev, dateTo: e.target.value }))}
          />
        </div>

        {/* Tenure Filter (Freehold vs Leasehold) */}
        <div className="filter-group">
          <label className="filter-label">Tenure</label>
          <select
            className="input-box"
            value={filters.tenure || 'all'}
            onChange={e => setFilters(prev => ({ ...prev, tenure: e.target.value }))}
          >
            <option value="all">All Tenures</option>
            <option value="freehold">Freehold / 999-yr</option>
            <option value="leasehold">Leasehold</option>
          </select>
        </div>

        {/* Min Price / Rent */}
        <div className="filter-group">
          <label className="filter-label">{viewMode === 'rental' ? 'Min Rent ($/mo)' : 'Min Price ($ SGD)'}</label>
          <input
            type="number"
            className="input-box"
            placeholder={viewMode === 'rental' ? 'e.g. 2000' : 'e.g. 1000000'}
            value={filters.priceMin ?? ''}
            onChange={e => setFilters(prev => ({ ...prev, priceMin: e.target.value ? parseFloat(e.target.value) : null }))}
          />
        </div>

        {/* Max Price / Rent */}
        <div className="filter-group">
          <label className="filter-label">{viewMode === 'rental' ? 'Max Rent ($/mo)' : 'Max Price ($ SGD)'}</label>
          <input
            type="number"
            className="input-box"
            placeholder={viewMode === 'rental' ? 'e.g. 8000' : 'e.g. 3500000'}
            value={filters.priceMax ?? ''}
            onChange={e => setFilters(prev => ({ ...prev, priceMax: e.target.value ? parseFloat(e.target.value) : null }))}
          />
        </div>

        {/* Bedroom Count Filter (Rental Mode Only) */}
        {viewMode === 'rental' && (
          <div className="filter-group">
            <label className="filter-label">Bedroom Count</label>
            <select
              className="input-box"
              value={filters.bedroomCount || 'all'}
              onChange={e => setFilters(prev => ({ ...prev, bedroomCount: e.target.value }))}
            >
              <option value="all">All Bedroom Types</option>
              <option value="1-Bedder">1-Bedder</option>
              <option value="2-Bedder">2-Bedder</option>
              <option value="3-Bedder">3-Bedder</option>
              <option value="4-Bedder">4-Bedder</option>
              <option value="5-Bedder">5-Bedder / Penthouse</option>
            </select>
          </div>
        )}

        {/* Unit Size Min/Max */}
        <div className="filter-group">
          <label className="filter-label">Floor Area Max (Sqft)</label>
          <input
            type="number"
            className="input-box"
            placeholder="e.g. 2500"
            value={filters.unitSizeMax || ''}
            onChange={e => setFilters(prev => ({ ...prev, unitSizeMax: parseFloat(e.target.value) || 10000 }))}
          />
        </div>
      </div>

      {/* Active Filter Pills */}
      <div className="selected-pills">
        {filters.projects.map((p, idx) => (
          <div key={idx} className="pill">
            <Building size={12} />
            <span>{p}</span>
            <X size={12} className="pill-remove" onClick={() => removeProjectPill(p)} />
          </div>
        ))}

        {filters.street && (
          <div className="pill">
            <MapPin size={12} />
            <span>Street: {filters.street}</span>
            <X size={12} className="pill-remove" onClick={() => setFilters(prev => ({ ...prev, street: null }))} />
          </div>
        )}

        {filters.district && (
          <div className="pill">
            <Map size={12} />
            <span>District {filters.district}</span>
            <X size={12} className="pill-remove" onClick={() => setFilters(prev => ({ ...prev, district: null }))} />
          </div>
        )}

        {filters.planningArea && (
          <div className="pill">
            <MapPin size={12} />
            <span>Area: {filters.planningArea}</span>
            <X size={12} className="pill-remove" onClick={() => setFilters(prev => ({ ...prev, planningArea: null }))} />
          </div>
        )}

        {filters.tenure && filters.tenure !== 'all' && (
          <div className="pill" style={{ borderColor: 'var(--color-primary-green)', color: 'var(--color-primary-green)', background: '#ECFDF5' }}>
            <span>Tenure: {filters.tenure === 'freehold' ? 'Freehold / 999-yr' : 'Leasehold'}</span>
            <X size={12} className="pill-remove" onClick={() => setFilters(prev => ({ ...prev, tenure: 'all' }))} />
          </div>
        )}

        {filters.priceMin != null && filters.priceMin !== '' && (
          <div className="pill" style={{ borderColor: 'var(--color-accent-teal)', color: 'var(--color-accent-teal)', background: '#F0FDFA' }}>
            <span>Min {viewMode === 'rental' ? 'Rent' : 'Price'}: ${Number(filters.priceMin).toLocaleString()}</span>
            <X size={12} className="pill-remove" onClick={() => setFilters(prev => ({ ...prev, priceMin: null }))} />
          </div>
        )}

        {filters.priceMax != null && filters.priceMax !== '' && (
          <div className="pill" style={{ borderColor: 'var(--color-accent-teal)', color: 'var(--color-accent-teal)', background: '#F0FDFA' }}>
            <span>Max {viewMode === 'rental' ? 'Rent' : 'Price'}: ${Number(filters.priceMax).toLocaleString()}</span>
            <X size={12} className="pill-remove" onClick={() => setFilters(prev => ({ ...prev, priceMax: null }))} />
          </div>
        )}

        {filters.radiusKm && filters.centerCoords && (
          <div className="pill" style={{ borderColor: 'var(--color-primary-terracotta)', color: 'var(--color-primary-terracotta)', background: 'rgba(203, 109, 81, 0.12)' }}>
            <MapPin size={12} />
            <span>Radius: {filters.radiusKm} km around ({filters.centerCoords.lat.toFixed(3)}, {filters.centerCoords.lng.toFixed(3)})</span>
            <X size={12} className="pill-remove" onClick={() => setFilters(prev => ({ ...prev, radiusKm: null, centerCoords: null }))} />
          </div>
        )}
      </div>
    </div>
  );
}
