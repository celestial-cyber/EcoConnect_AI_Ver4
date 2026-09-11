const MAP_SCRIPT_ID = 'eco-google-maps-script'
const DEFAULT_CENTER = { lat: 17.4485, lng: 78.3908 }

export const DEFAULT_MAP_CENTER = DEFAULT_CENTER

export function loadGoogleMaps() {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Google Maps can only be loaded in the browser.'))
  }

  const apiKey = import.meta.env?.VITE_GOOGLE_MAPS_API_KEY
  if (!apiKey) {
    return Promise.reject(new Error('VITE_GOOGLE_MAPS_API_KEY is not set.'))
  }

  if (window.google?.maps) {
    return Promise.resolve(window.google.maps)
  }

  const existing = document.getElementById(MAP_SCRIPT_ID)
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener('load', () => resolve(window.google.maps), { once: true })
      existing.addEventListener('error', () => reject(new Error('Google Maps script failed to load.')), { once: true })
    })
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.id = MAP_SCRIPT_ID
    script.async = true
    script.defer = true
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=marker`
    script.onload = () => {
      if (window.google?.maps) {
        resolve(window.google.maps)
      } else {
        reject(new Error('Google Maps failed to initialize.'))
      }
    }
    script.onerror = () => reject(new Error('Google Maps script could not be loaded.'))
    document.head.appendChild(script)
  })
}

export const darkMapStyles = [
  { elementType: 'geometry', stylers: [{ color: '#0c1713' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0c1713' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#d7efe7' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#234039' }] },
  { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#0f1f1a' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#132b25' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#19342c' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1f332f' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#2b433b' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#101d20' }] },
  { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#172e2b' }] },
]
