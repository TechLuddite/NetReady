import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { TracertHop } from '../types';
import {
  MapPin,
  Play,
  Pause,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Navigation,
  Globe,
  Layers,
  Radio,
  Zap,
} from 'lucide-react';

interface TracertMapProps {
  hops: TracertHop[];
  activeHopNumber: number | null;
  onSelectHop: (hopNumber: number) => void;
  isTracing: boolean;
}

export const TracertMap: React.FC<TracertMapProps> = ({
  hops,
  activeHopNumber,
  onSelectHop,
  isTracing,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersRef = useRef<{ [hopNum: number]: L.Marker }>({});
  const polylineRef = useRef<L.Polyline | null>(null);

  const [autoFollow, setAutoFollow] = useState(true);
  const [isPlayingRoute, setIsPlayingRoute] = useState(false);
  const [mapMode, setMapMode] = useState<'leaflet' | 'vector'>('leaflet');

  // Initialize Leaflet Map
  useEffect(() => {
    if (mapMode !== 'leaflet' || !mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: [20, 0],
        zoom: 2,
        minZoom: 1,
        maxZoom: 18,
        zoomControl: false,
      });

      // CartoDB Dark Matter tile layer
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19,
      }).addTo(map);

      L.control.zoom({ position: 'bottomright' }).addTo(map);

      mapInstanceRef.current = map;
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [mapMode]);

  // Update Markers and Polylines whenever hops or activeHopNumber changes
  useEffect(() => {
    if (mapMode !== 'leaflet' || !mapInstanceRef.current) return;

    const map = mapInstanceRef.current;

    // Clear existing markers
    Object.values(markersRef.current).forEach((m) => map.removeLayer(m));
    markersRef.current = {};

    if (polylineRef.current) {
      map.removeLayer(polylineRef.current);
      polylineRef.current = null;
    }

    if (hops.length === 0) return;

    const latLngs: [number, number][] = [];

    hops.forEach((hop) => {
      if (!hop.lat || !hop.lng) return;
      const coords: [number, number] = [hop.lat, hop.lng];
      latLngs.push(coords);

      const isActive = hop.hop === activeHopNumber;

      // Color based on node type
      let badgeBg = '#06b6d4'; // Cyan
      if (hop.nodeType === 'client' || hop.nodeType === 'gateway') badgeBg = '#10b981'; // Emerald
      else if (hop.nodeType === 'destination') badgeBg = '#f43f5e'; // Rose
      else if (hop.nodeType === 'backbone') badgeBg = '#8b5cf6'; // Purple

      if (isActive) badgeBg = '#eab308'; // Gold

      // Create Custom HTML Div Icon
      const customIcon = L.divIcon({
        className: 'custom-tracert-marker',
        html: `
          <div style="
            position: relative;
            width: ${isActive ? '34px' : '26px'};
            height: ${isActive ? '34px' : '26px'};
            background: ${badgeBg};
            border: 2px solid rgba(255, 255, 255, 0.9);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #000;
            font-weight: 800;
            font-size: ${isActive ? '12px' : '10px'};
            font-family: monospace;
            box-shadow: 0 0 ${isActive ? '20px' : '10px'} ${badgeBg};
            cursor: pointer;
            transition: all 0.3s ease;
          ">
            ${hop.hop}
            ${
              isActive
                ? `<div style="
                    position: absolute;
                    inset: -8px;
                    border: 2px solid ${badgeBg};
                    border-radius: 50%;
                    animation: pulseRing 1.5s infinite;
                  "></div>`
                : ''
            }
          </div>
        `,
        iconSize: [isActive ? 34 : 26, isActive ? 34 : 26],
        iconAnchor: [isActive ? 17 : 13, isActive ? 17 : 13],
      });

      const marker = L.marker(coords, { icon: customIcon }).addTo(map);

      // Popup details
      marker.bindPopup(`
        <div style="font-family: monospace; color: #f8fafc; background: #0f172a; padding: 10px; border-radius: 8px; border: 1px solid #334155; min-width: 180px;">
          <div style="color: ${badgeBg}; font-weight: bold; font-size: 13px; margin-bottom: 4px;">
            Hop #${hop.hop} • ${hop.nodeType.toUpperCase()}
          </div>
          <div style="font-weight: bold; font-size: 12px; color: #fff; margin-bottom: 2px;">
            ${hop.hostname || hop.ip}
          </div>
          <div style="color: #94a3b8; font-size: 11px;">IP: ${hop.ip}</div>
          <div style="color: #38bdf8; font-size: 11px;">RTT: ${hop.avgRtt > 0 ? `${hop.avgRtt} ms` : 'Timeout'}</div>
          <div style="color: #cbd5e1; font-size: 11px; margin-top: 4px;">📍 ${hop.city}, ${hop.country}</div>
          <div style="color: #64748b; font-size: 10px;">${hop.isp}</div>
        </div>
      `, {
        className: 'tracert-dark-popup',
      });

      marker.on('click', () => {
        onSelectHop(hop.hop);
      });

      markersRef.current[hop.hop] = marker;
    });

    // Draw glowing polyline connecting hops
    if (latLngs.length > 1) {
      polylineRef.current = L.polyline(latLngs, {
        color: '#06b6d4',
        weight: 3,
        opacity: 0.8,
        dashArray: '8, 8',
      }).addTo(map);
    }

    // Follow Active Hop or Latest Hop
    if (autoFollow && activeHopNumber && markersRef.current[activeHopNumber]) {
      const activeHopObj = hops.find((h) => h.hop === activeHopNumber);
      if (activeHopObj && activeHopObj.lat && activeHopObj.lng) {
        map.flyTo([activeHopObj.lat, activeHopObj.lng], Math.max(map.getZoom(), 4), {
          duration: 0.8,
        });
      }
    }
  }, [hops, activeHopNumber, autoFollow, mapMode, onSelectHop]);

  // Handle Play Route Animation Step Loop
  useEffect(() => {
    if (!isPlayingRoute || hops.length === 0) return;

    let currentIdx = 0;
    const interval = setInterval(() => {
      const nextHop = hops[currentIdx];
      if (nextHop) {
        onSelectHop(nextHop.hop);
      }
      currentIdx = (currentIdx + 1) % hops.length;
    }, 1500);

    return () => clearInterval(interval);
  }, [isPlayingRoute, hops, onSelectHop]);

  const fitAllBounds = () => {
    if (!mapInstanceRef.current || hops.length === 0) return;

    const validCoords: [number, number][] = hops
      .filter((h) => h.lat && h.lng)
      .map((h) => [h.lat, h.lng]);

    if (validCoords.length > 0) {
      const bounds = L.latLngBounds(validCoords);
      mapInstanceRef.current.fitBounds(bounds, { padding: [40, 40] });
    }
  };

  const handleStepBack = () => {
    if (!activeHopNumber || activeHopNumber <= 1) return;
    onSelectHop(activeHopNumber - 1);
  };

  const handleStepForward = () => {
    if (!activeHopNumber || activeHopNumber >= hops.length) return;
    onSelectHop(activeHopNumber + 1);
  };

  const activeHop = hops.find((h) => h.hop === activeHopNumber) || hops[hops.length - 1];

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl flex flex-col relative">
      {/* Map Control Header */}
      <div className="bg-slate-950/80 px-4 py-3 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 z-10">
        <div className="flex items-center space-x-2">
          <Navigation className="w-4 h-4 text-cyan-400 animate-pulse" />
          <span className="text-xs font-bold font-mono text-slate-200 uppercase tracking-wider">
            Live Route Geo-Hop Map
          </span>
          {isTracing && (
            <span className="flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-cyan-500/20 text-cyan-400 border border-cyan-500/40">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
              <span>Tracing Hop {hops.length}...</span>
            </span>
          )}
        </div>

        {/* Action Toolbar */}
        <div className="flex items-center space-x-2">
          {/* Step Back / Play / Step Forward */}
          <div className="flex items-center space-x-1 bg-slate-900 border border-slate-800 rounded-xl p-1">
            <button
              onClick={handleStepBack}
              disabled={!activeHopNumber || activeHopNumber <= 1}
              className="p-1.5 text-slate-400 hover:text-cyan-400 disabled:opacity-30 rounded-lg transition-colors"
              title="Previous Hop"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>

            <button
              onClick={() => setIsPlayingRoute(!isPlayingRoute)}
              disabled={hops.length === 0}
              className={`px-2.5 py-1 text-xs font-mono font-bold rounded-lg flex items-center space-x-1 transition-colors ${
                isPlayingRoute
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  : 'bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
              }`}
            >
              {isPlayingRoute ? (
                <>
                  <Pause className="w-3 h-3" />
                  <span>Pause</span>
                </>
              ) : (
                <>
                  <Play className="w-3 h-3 fill-cyan-400" />
                  <span>Play Path</span>
                </>
              )}
            </button>

            <button
              onClick={handleStepForward}
              disabled={!activeHopNumber || activeHopNumber >= hops.length}
              className="p-1.5 text-slate-400 hover:text-cyan-400 disabled:opacity-30 rounded-lg transition-colors"
              title="Next Hop"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Auto-Follow Hop Toggle */}
          <button
            onClick={() => setAutoFollow(!autoFollow)}
            className={`px-2.5 py-1.5 rounded-xl text-xs font-mono font-semibold border flex items-center space-x-1.5 transition-all ${
              autoFollow
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-sm'
                : 'bg-slate-800 text-slate-400 border-slate-700'
            }`}
            title="Auto-pan map to active hop"
          >
            <Radio className={`w-3.5 h-3.5 ${autoFollow ? 'text-emerald-400 animate-spin' : ''}`} />
            <span className="hidden sm:inline">Follow Hop</span>
          </button>

          {/* Fit Bounds */}
          <button
            onClick={fitAllBounds}
            disabled={hops.length === 0}
            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-xl text-xs transition-colors disabled:opacity-40"
            title="Fit All Hops on Map"
          >
            <Maximize2 className="w-3.5 h-3.5 text-slate-300" />
          </button>

          {/* View Mode Switcher */}
          <div className="flex bg-slate-900 border border-slate-800 rounded-xl p-0.5">
            <button
              onClick={() => setMapMode('leaflet')}
              className={`px-2 py-1 rounded-lg text-[10px] font-mono uppercase font-bold transition-all ${
                mapMode === 'leaflet'
                  ? 'bg-cyan-500 text-black shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Leaflet
            </button>
            <button
              onClick={() => setMapMode('vector')}
              className={`px-2 py-1 rounded-lg text-[10px] font-mono uppercase font-bold transition-all ${
                mapMode === 'vector'
                  ? 'bg-cyan-500 text-black shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Vector
            </button>
          </div>
        </div>
      </div>

      {/* Map Stage Container */}
      <div className="relative h-[420px] sm:h-[480px] w-full bg-[#050811]">
        {mapMode === 'leaflet' ? (
          <div ref={mapContainerRef} className="h-full w-full z-0" />
        ) : (
          /* High-Tech Vector Projection Map Fallback */
          <div className="h-full w-full relative flex items-center justify-center p-6 overflow-hidden bg-slate-950">
            {/* World Grid Lines Background */}
            <svg className="absolute inset-0 w-full h-full opacity-20 pointer-events-none" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                  <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#06b6d4" strokeWidth="0.5" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#grid)" />
            </svg>

            {/* SVG Arc Connecting Paths */}
            {hops.length > 0 ? (
              <svg className="w-full h-full absolute inset-0 pointer-events-none">
                {hops.map((h, idx) => {
                  if (idx === 0) return null;
                  const prev = hops[idx - 1];
                  // Map Lat/Lng to % offsets
                  const x1 = ((prev.lng + 180) / 360) * 100;
                  const y1 = ((90 - prev.lat) / 180) * 100;
                  const x2 = ((h.lng + 180) / 360) * 100;
                  const y2 = ((90 - h.lat) / 180) * 100;

                  return (
                    <g key={h.hop}>
                      <line
                        x1={`${x1}%`}
                        y1={`${y1}%`}
                        x2={`${x2}%`}
                        y2={`${y2}%`}
                        stroke="#06b6d4"
                        strokeWidth="2"
                        strokeDasharray="4 4"
                        opacity="0.7"
                      />
                    </g>
                  );
                })}
              </svg>
            ) : null}

            {/* Vector Nodes */}
            {hops.map((h) => {
              const x = ((h.lng + 180) / 360) * 100;
              const y = ((90 - h.lat) / 180) * 100;
              const isActive = h.hop === activeHopNumber;

              return (
                <div
                  key={h.hop}
                  onClick={() => onSelectHop(h.hop)}
                  style={{ left: `${x}%`, top: `${y}%` }}
                  className={`absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer group transition-all z-10 ${
                    isActive ? 'scale-125 z-20' : 'hover:scale-110'
                  }`}
                >
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center font-mono font-bold text-xs border-2 shadow-lg transition-all ${
                      isActive
                        ? 'bg-amber-400 text-black border-white shadow-amber-500/50 scale-110'
                        : h.nodeType === 'destination'
                        ? 'bg-rose-500 text-white border-white shadow-rose-500/40'
                        : 'bg-cyan-500 text-black border-slate-900 shadow-cyan-500/40'
                    }`}
                  >
                    {h.hop}
                  </div>

                  {/* Hover Tooltip */}
                  <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover:block bg-slate-900 text-white text-[10px] font-mono px-2 py-1 rounded border border-slate-700 whitespace-nowrap shadow-xl z-30">
                    #{h.hop} {h.hostname || h.ip} ({h.city}, {h.country})
                  </div>
                </div>
              );
            })}

            {hops.length === 0 && (
              <div className="text-center text-slate-500 font-mono text-xs">
                Enter a host target above and click "Run Route Traceroute" to project map path.
              </div>
            )}
          </div>
        )}

        {/* Active Hop Overlay Card Drawer */}
        {activeHop && (
          <div className="absolute bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:w-80 bg-slate-950/90 border border-slate-800 rounded-2xl p-4 shadow-2xl backdrop-blur-md z-10 space-y-2">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <div className="flex items-center space-x-2">
                <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-ping" />
                <span className="text-xs font-bold font-mono text-cyan-400 uppercase">
                  Hop #{activeHop.hop} Details
                </span>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300 uppercase border border-slate-700">
                {activeHop.nodeType}
              </span>
            </div>

            <div className="space-y-1 font-mono text-xs">
              <div className="text-sm font-bold text-white truncate">
                {activeHop.hostname || activeHop.ip}
              </div>
              <div className="text-slate-400 text-[11px]">IP Address: <span className="text-slate-200">{activeHop.ip}</span></div>

              <div className="flex justify-between items-center py-1 border-t border-slate-800/80 mt-1 text-[11px]">
                <span className="text-slate-400">Response Latency:</span>
                <span className={`font-bold ${activeHop.avgRtt > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {activeHop.avgRtt > 0 ? `${activeHop.avgRtt} ms` : 'Timed Out'}
                </span>
              </div>

              <div className="flex justify-between items-center text-[11px]">
                <span className="text-slate-400">Location:</span>
                <span className="text-slate-200 truncate max-w-[140px] text-right">
                  📍 {activeHop.city}, {activeHop.country}
                </span>
              </div>

              <div className="flex justify-between items-center text-[11px]">
                <span className="text-slate-400">ISP / AS:</span>
                <span className="text-cyan-400 truncate max-w-[140px] text-right">
                  {activeHop.isp} ({activeHop.asn})
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
