import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { DEFAULT_MAP_CENTER, darkMapStyles, loadGoogleMaps } from '../lib/googleMaps.js'
import { dot } from './MapPlot.jsx'

/**
 * Drag the pin, click the map, or hit "Use my location". Nobody types
 * a latitude. `onChange({lat,lng})` fires on every move.
 */
export default function LocationPicker({
  value,
  onChange,
  landmarks = [],
  rings = [],
  caption = 'CLICK OR DRAG TO PLACE THE PIN',
  onUseMyLocation,
  locating = false,
  height,
}) {
  const el = useRef(null)
  const map = useRef(null)
  const pin = useRef(null)
  const circleRef = useRef([])
  const markersRef = useRef([])
  const leafletRef = useRef(null)
  const valueRef = useRef(value)
  const cb = useRef(onChange)
  valueRef.current = value
  cb.current = onChange

  const renderLeaflet = () => {
    if (!el.current || leafletRef.current) return
    const current = valueRef.current
    const start = current?.lat != null ? [current.lat, current.lng] : [DEFAULT_MAP_CENTER.lat, DEFAULT_MAP_CENTER.lng]
    const leafletMap = L.map(el.current, { scrollWheelZoom: false }).setView(start, 13)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors', maxZoom: 19,
    }).addTo(leafletMap)
    const marker = L.marker(start, { draggable: true }).addTo(leafletMap)
    marker.on('dragend', () => {
      const pos = marker.getLatLng()
      cb.current?.({ lat: round6(pos.lat), lng: round6(pos.lng) })
    })
    leafletMap.on('click', (e) => cb.current?.({ lat: round6(e.latlng.lat), lng: round6(e.latlng.lng) }))
    leafletRef.current = { map: leafletMap, marker }
  }

  useEffect(() => {
    if (!el.current) return
    let cancelled = false

    loadGoogleMaps()
      .then((maps) => {
        if (cancelled || !el.current) return
        const current = valueRef.current
        const start = current?.lat != null ? { lat: current.lat, lng: current.lng } : DEFAULT_MAP_CENTER
        const gmap = new maps.Map(el.current, {
          center: start,
          zoom: 13,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          zoomControl: true,
          scrollwheel: false,
          styles: darkMapStyles,
        })
        map.current = gmap

        const movePin = (lat, lng) => {
          if (!pin.current) {
            pin.current = new maps.marker.AdvancedMarkerElement({
              position: { lat, lng },
              title: 'Selected location',
              content: dot('org', 'HERE'),
              gmpDraggable: true,
            })
            pin.current.addListener('dragend', () => {
              const pos = pin.current.position
              cb.current?.({ lat: round6(pos.lat), lng: round6(pos.lng) })
            })
            pin.current.setMap(gmap)
          } else {
            pin.current.position = { lat, lng }
          }
        }

        movePin(start.lat, start.lng)
        gmap.addListener('click', (e) => {
          const lat = e.latLng.lat()
          const lng = e.latLng.lng()
          cb.current?.({ lat: round6(lat), lng: round6(lng) })
        })

        const refreshExtras = () => {
          circleRef.current.forEach((circle) => circle.setMap(null))
          circleRef.current = []
          markersRef.current.forEach((marker) => marker.setMap(null))
          markersRef.current = []

          for (const r of rings) {
            if (!Number.isFinite(r?.lat)) continue
            const circle = new maps.Circle({
              center: { lat: r.lat, lng: r.lng },
              radius: Number(r.radius_km) * 1000,
              strokeColor: '#3be07f',
              strokeOpacity: 0.7,
              strokeWeight: 1,
              fillColor: '#22c55e',
              fillOpacity: 0.06,
              map: gmap,
            })
            circleRef.current.push(circle)
          }

          for (const l of landmarks) {
            const marker = new maps.marker.AdvancedMarkerElement({
              position: { lat: l.lat, lng: l.lng },
              title: l.label,
              content: dot('muted', l.label),
            })
            marker.addListener('click', () => cb.current?.({ lat: l.lat, lng: l.lng }))
            marker.setMap(gmap)
            markersRef.current.push(marker)
          }
        }

        refreshExtras()
      })
      .catch(() => {
        if (!cancelled && el.current) {
          renderLeaflet()
        }
      })

    return () => {
      cancelled = true
      markerCleanup()
      leafletRef.current?.map.remove()
      leafletRef.current = null
    }
  }, [])

  useEffect(() => {
    if (leafletRef.current && value?.lat != null) {
      const target = [value.lat, value.lng]
      leafletRef.current.marker.setLatLng(target)
      leafletRef.current.map.panTo(target)
      return
    }
    if (!map.current || !pin.current || value?.lat == null) return
    const target = { lat: value.lat, lng: value.lng }
    pin.current.position = target
    map.current.panTo(target)
  }, [value?.lat, value?.lng])

  useEffect(() => {
    if (!map.current || !window.google?.maps) return

    circleRef.current.forEach((circle) => circle.setMap(null))
    circleRef.current = []
    markersRef.current.forEach((marker) => marker.setMap(null))
    markersRef.current = []

    const maps = window.google.maps
    for (const r of rings) {
      if (!Number.isFinite(r?.lat)) continue
      const circle = new maps.Circle({
        center: { lat: r.lat, lng: r.lng },
        radius: Number(r.radius_km) * 1000,
        strokeColor: '#3be07f',
        strokeOpacity: 0.7,
        strokeWeight: 1,
        fillColor: '#22c55e',
        fillOpacity: 0.06,
        map: map.current,
      })
      circleRef.current.push(circle)
    }

    for (const l of landmarks) {
      const marker = new maps.marker.AdvancedMarkerElement({
        position: { lat: l.lat, lng: l.lng },
        title: l.label,
        content: dot('muted', l.label),
      })
      marker.addListener('click', () => cb.current?.({ lat: l.lat, lng: l.lng }))
      marker.setMap(map.current)
      markersRef.current.push(marker)
    }
  }, [rings, landmarks])

  const markerCleanup = () => {
    circleRef.current.forEach((circle) => circle?.setMap(null))
    circleRef.current = []
    markersRef.current.forEach((marker) => marker?.setMap(null))
    markersRef.current = []
    if (pin.current) {
      pin.current.setMap(null)
      pin.current = null
    }
    if (map.current) {
      map.current = null
    }
  }

  return (
    <>
      <div className="mapwrap" style={height ? { height } : undefined}>
        <div ref={el} className="mapcanvas" />
        {caption && <div className="mapcap">{caption}</div>}
      </div>

      <div className="checks" style={{ marginTop: 12 }}>
        {onUseMyLocation && (
          <button type="button" className="btn ghost sm" onClick={onUseMyLocation} disabled={locating}>
            {locating ? 'Detecting location…' : '◎ Auto-detect my location'}
          </button>
        )}
        {landmarks.map((l) => (
          <button key={l.label} type="button" className="check"
            onClick={() => onChange?.({ lat: l.lat, lng: l.lng })}>
            {l.label}
          </button>
        ))}
      </div>

      {value?.lat != null && (
        <div className="mono" style={{ marginTop: 10, fontSize: 10.5, letterSpacing: '.1em', color: 'var(--muted)' }}>
          {Number(value.lat).toFixed(5)}, {Number(value.lng).toFixed(5)}
        </div>
      )}
    </>
  )
}

const round6 = (n) => Math.round(n * 1e6) / 1e6
