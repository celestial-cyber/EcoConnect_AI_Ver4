import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { darkMapStyles, DEFAULT_MAP_CENTER, loadGoogleMaps } from '../lib/googleMaps.js'

export function dot(kind = 'stop', label = '') {
  const color = kind === 'org' ? '#fbbf24' : kind === 'muted' ? '#94a3b8' : kind === 'me' ? '#5eead4' : '#3be07f'
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18">
      <circle cx="9" cy="9" r="6" fill="${color}" stroke="rgba(7,12,9,0.92)" stroke-width="2" />
      <circle cx="9" cy="9" r="2.6" fill="#ffffff" fill-opacity="0.8" />
    </svg>
  `
  const pin = document.createElement('div')
  pin.className = 'ecomark'
  pin.innerHTML = `${svg}${label ? `<b>${String(label).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))}</b>` : ''}`
  return pin
}

export default function MapPlot({ points = [], route = [], rings = [], caption, height }) {
  const el = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef([])
  const circleRef = useRef([])
  const routePathRef = useRef(null)
  const leafletRef = useRef(null)

  const renderLeaflet = () => {
    if (!el.current || leafletRef.current) return
    const map = L.map(el.current, { scrollWheelZoom: false }).setView(
      [DEFAULT_MAP_CENTER.lat, DEFAULT_MAP_CENTER.lng], 12
    )
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors', maxZoom: 19,
    }).addTo(map)
    const bounds = []
    for (const r of rings) {
      if (!Number.isFinite(r?.lat) || !Number.isFinite(r?.lng)) continue
      L.circle([r.lat, r.lng], {
        radius: Number(r.radius_km) * 1000, color: '#3be07f', fillColor: '#22c55e', fillOpacity: 0.08,
      }).addTo(map)
      bounds.push([r.lat, r.lng])
    }
    const path = route.filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng))
      .map((p) => [p.lat, p.lng])
    if (path.length > 1) {
      L.polyline(path, { color: '#3be07f', weight: 3 }).addTo(map)
      bounds.push(...path)
    }
    for (const p of points) {
      if (!Number.isFinite(p?.lat) || !Number.isFinite(p?.lng)) continue
      L.marker([p.lat, p.lng], { title: p.label || 'EcoConnect' })
        .addTo(map).bindTooltip(p.label || 'EcoConnect')
      bounds.push([p.lat, p.lng])
    }
    if (bounds.length) map.fitBounds(bounds, { padding: [24, 24] })
    leafletRef.current = map
  }

  useEffect(() => {
    if (!el.current) return
    let cancelled = false

    loadGoogleMaps()
      .then((maps) => {
        if (cancelled || !el.current) return

        const map = new maps.Map(el.current, {
          center: DEFAULT_MAP_CENTER,
          zoom: 12,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          zoomControl: true,
          scrollwheel: false,
          disableDoubleClickZoom: false,
          styles: darkMapStyles,
        })

        mapRef.current = map
        const bounds = new maps.LatLngBounds()

        const addMarker = (lat, lng, label, kind = 'stop') => {
          const marker = new maps.marker.AdvancedMarkerElement({
            position: { lat, lng },
            title: label || 'EcoConnect',
            content: dot(kind, label),
          })
          marker.setMap(map)
          markersRef.current.push(marker)
          bounds.extend({ lat, lng })
        }

        const addCircle = (lat, lng, radiusKm) => {
          const circle = new maps.Circle({
            center: { lat, lng },
            radius: Number(radiusKm) * 1000,
            strokeColor: '#3be07f',
            strokeOpacity: 0.8,
            strokeWeight: 1,
            fillColor: '#22c55e',
            fillOpacity: 0.08,
            map,
            draggable: false,
          })
          circleRef.current.push(circle)
          bounds.extend({ lat, lng })
        }

        for (const r of rings) {
          if (Number.isFinite(r?.lat)) addCircle(r.lat, r.lng, r.radius_km)
        }

        const polyline = route.filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng))
        if (polyline.length > 1) {
          const path = polyline.map((p) => ({ lat: p.lat, lng: p.lng }))
          routePathRef.current = new maps.Polyline({
            path,
            geodesic: true,
            strokeColor: '#3be07f',
            strokeOpacity: 0.9,
            strokeWeight: 3,
            map,
          })
          path.forEach((p) => bounds.extend(p))
        }

        for (const p of points) {
          if (Number.isFinite(p?.lat) && Number.isFinite(p?.lng)) {
            addMarker(p.lat, p.lng, p.label, p.kind)
          }
        }

        if (bounds.isEmpty()) {
          map.setCenter(DEFAULT_MAP_CENTER)
          map.setZoom(12)
        } else if (bounds.getNorthEast().equals(bounds.getSouthWest())) {
          map.setCenter(bounds.getCenter())
          map.setZoom(14)
        } else {
          map.fitBounds(bounds, { top: 20, right: 20, bottom: 20, left: 20 })
        }
      })
      .catch(() => {
        if (!cancelled && el.current) {
          renderLeaflet()
        }
      })

    return () => {
      cancelled = true
      markersRef.current.forEach((marker) => marker?.setMap(null))
      markersRef.current = []
      circleRef.current.forEach((circle) => circle?.setMap(null))
      circleRef.current = []
      if (routePathRef.current) {
        routePathRef.current.setMap(null)
        routePathRef.current = null
      }
      if (mapRef.current) {
        window.google?.maps?.event?.clearInstanceListeners(mapRef.current)
        mapRef.current = null
      }
      leafletRef.current?.remove()
      leafletRef.current = null
    }
  }, [])

  useEffect(() => {
    if (leafletRef.current) return
    if (!mapRef.current || !window.google?.maps) return

    const markers = markersRef.current
    const circles = circleRef.current
    const map = mapRef.current
    const bounds = new window.google.maps.LatLngBounds()

    markers.forEach((marker) => marker.setMap(null))
    circles.forEach((circle) => circle.setMap(null))
    if (routePathRef.current) routePathRef.current.setMap(null)
    markersRef.current = []
    circleRef.current = []
    routePathRef.current = null

    for (const r of rings) {
      if (Number.isFinite(r?.lat)) {
        const circle = new window.google.maps.Circle({
          center: { lat: r.lat, lng: r.lng },
          radius: Number(r.radius_km) * 1000,
          strokeColor: '#3be07f',
          strokeOpacity: 0.8,
          strokeWeight: 1,
          fillColor: '#22c55e',
          fillOpacity: 0.08,
          map,
        })
        circleRef.current.push(circle)
        bounds.extend({ lat: r.lat, lng: r.lng })
      }
    }

    const polyline = route.filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng))
    if (polyline.length > 1) {
      const path = polyline.map((p) => ({ lat: p.lat, lng: p.lng }))
      routePathRef.current = new window.google.maps.Polyline({
        path,
        geodesic: true,
        strokeColor: '#3be07f',
        strokeOpacity: 0.9,
        strokeWeight: 3,
        map,
      })
      path.forEach((p) => bounds.extend(p))
    }

    for (const p of points) {
      if (Number.isFinite(p?.lat) && Number.isFinite(p?.lng)) {
        const marker = new window.google.maps.marker.AdvancedMarkerElement({
          position: { lat: p.lat, lng: p.lng },
          title: p.label || 'EcoConnect',
          content: dot(p.kind, p.label),
        })
        marker.setMap(map)
        markersRef.current.push(marker)
        bounds.extend({ lat: p.lat, lng: p.lng })
      }
    }

    if (bounds.isEmpty()) {
      map.setCenter(DEFAULT_MAP_CENTER)
      map.setZoom(12)
    } else if (bounds.getNorthEast().equals(bounds.getSouthWest())) {
      map.setCenter(bounds.getCenter())
      map.setZoom(14)
    } else {
      map.fitBounds(bounds, { top: 20, right: 20, bottom: 20, left: 20 })
    }
  }, [points, route, rings])

  return (
    <div className="mapwrap" style={height ? { height } : undefined}>
      <div ref={el} className="mapcanvas" />
      {caption && <div className="mapcap">{caption}</div>}
    </div>
  )
}
