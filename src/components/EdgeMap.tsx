import React, { useEffect, useRef } from 'react';
import L from 'leaflet';

/**
 * Map of real, measured network geography.
 *
 * Deliberately narrower than the route map it sits beside: it draws only points
 * whose coordinates came from somewhere verifiable — a CDN edge identified by
 * IATA code, or a client location reported by the edge itself — plus distance
 * constraints derived from round-trip time.
 *
 * There are no interpolated waypoints, because there is nothing to interpolate
 * between: a browser cannot see the routers in the middle.
 */

export interface MapNode {
  id: string;
  lat: number;
  lng: number;
  kind: 'client' | 'edge-pop' | 'target-pop';
  label: string;
  detail: string[];
}

export interface MapLink {
  fromId: string;
  toId: string;
  label?: string;
}

/**
 * A distance constraint, not a location.
 *
 * Radius is the furthest the client can possibly be from this point given the
 * measured round trip. The client is somewhere inside the circle; the circle
 * does not claim to know where.
 */
export interface MapRing {
  centerLat: number;
  centerLng: number;
  radiusKm: number;
  label: string;
}

interface EdgeMapProps {
  nodes: MapNode[];
  links: MapLink[];
  rings: MapRing[];
  heightClass?: string;
}

const NODE_COLOUR: Record<MapNode['kind'], string> = {
  client: '#10b981', // emerald
  'edge-pop': '#06b6d4', // cyan
  'target-pop': '#f43f5e', // rose
};

const NODE_GLYPH: Record<MapNode['kind'], string> = {
  client: '◎',
  'edge-pop': '▲',
  'target-pop': '◆',
};

/** Element factory that applies text via textContent, never innerHTML. */
function el(tag: string, cssText: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.style.cssText = cssText;
  if (text !== undefined) node.textContent = text;
  return node;
}

function buildBadge(node: MapNode): HTMLElement {
  const colour = NODE_COLOUR[node.kind];
  return el(
    'div',
    `width:28px;height:28px;background:${colour};border:2px solid rgba(255,255,255,0.9);` +
      'border-radius:50%;display:flex;align-items:center;justify-content:center;color:#000;' +
      `font-weight:800;font-size:13px;font-family:monospace;box-shadow:0 0 14px ${colour};`,
    NODE_GLYPH[node.kind],
  );
}

/**
 * Popup content, assembled as DOM nodes.
 *
 * Labels here include hostnames the user typed and strings returned by remote
 * services, so none of it may be interpolated into markup.
 */
function buildPopup(node: MapNode): HTMLElement {
  const colour = NODE_COLOUR[node.kind];
  const wrap = el(
    'div',
    'font-family:monospace;color:#f8fafc;background:#0f172a;padding:10px;border-radius:8px;' +
      'border:1px solid #334155;min-width:180px;',
  );
  wrap.appendChild(
    el('div', `color:${colour};font-weight:bold;font-size:13px;margin-bottom:4px;`, node.label),
  );
  for (const line of node.detail) {
    wrap.appendChild(el('div', 'color:#94a3b8;font-size:11px;line-height:1.5;', line));
  }
  return wrap;
}

export const EdgeMap: React.FC<EdgeMapProps> = ({
  nodes,
  links,
  rings,
  heightClass = 'h-[420px]',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  // Map instance is created once and torn down on unmount.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [20, 0],
      zoom: 2,
      minZoom: 1,
      maxZoom: 12,
      zoomControl: false,
      worldCopyJump: true,
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 19,
    }).addTo(map);

    L.control.zoom({ position: 'bottomright' }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  // Redraw contents. Depends only on the data, so unrelated parent renders do
  // not tear down and rebuild every layer.
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;

    layer.clearLayers();

    const byId = new Map(nodes.map((n) => [n.id, n]));
    const bounds: [number, number][] = [];

    // Rings first so markers draw above them.
    for (const ring of rings) {
      L.circle([ring.centerLat, ring.centerLng], {
        radius: ring.radiusKm * 1000,
        color: '#06b6d4',
        weight: 1,
        opacity: 0.5,
        fillColor: '#06b6d4',
        fillOpacity: 0.05,
        dashArray: '4 6',
      })
        .bindTooltip(ring.label, { direction: 'top', className: 'edge-ring-tooltip' })
        .addTo(layer);
    }

    for (const link of links) {
      const from = byId.get(link.fromId);
      const to = byId.get(link.toId);
      if (!from || !to) continue;
      L.polyline(
        [
          [from.lat, from.lng],
          [to.lat, to.lng],
        ],
        { color: '#06b6d4', weight: 2, opacity: 0.7, dashArray: '6 6' },
      ).addTo(layer);
    }

    for (const node of nodes) {
      bounds.push([node.lat, node.lng]);
      L.marker([node.lat, node.lng], {
        icon: L.divIcon({
          className: 'custom-tracert-marker',
          html: buildBadge(node),
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        }),
        title: node.label,
      })
        .bindPopup(buildPopup(node), { className: 'tracert-dark-popup' })
        .addTo(layer);
    }

    if (bounds.length === 1) {
      map.setView(bounds[0], 5, { animate: true });
    } else if (bounds.length > 1) {
      map.fitBounds(L.latLngBounds(bounds).pad(0.3), { animate: true });
    }
  }, [nodes, links, rings]);

  return (
    <div className={`relative w-full ${heightClass} rounded-2xl overflow-hidden border border-slate-800`}>
      <div ref={containerRef} className="absolute inset-0 z-0" />

      {nodes.length === 0 && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-950/70 pointer-events-none">
          <p className="text-xs text-slate-400 font-mono text-center px-6">
            No mapped locations yet. Run an exploration to place your edge on the map.
          </p>
        </div>
      )}

      <div className="absolute bottom-2 left-2 z-10 flex flex-wrap gap-2 pointer-events-none">
        {(
          [
            ['client', 'You'],
            ['edge-pop', 'CDN edge'],
            ['target-pop', 'Target edge'],
          ] as const
        ).map(([kind, label]) => (
          <span
            key={kind}
            className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-950/85 border border-white/10 text-[10px] font-mono text-slate-300"
          >
            <span
              className="w-2 h-2 rounded-full"
              style={{ background: NODE_COLOUR[kind] }}
              aria-hidden="true"
            />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
};
