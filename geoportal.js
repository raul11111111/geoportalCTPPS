const SUPABASE_URL = 'https://cpncorgnobpmrzkszahw.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_EG-rKfpPD6nmYiojNCmLOQ_m_14xFb1';
  
  const map = L.map('map', { zoomControl: false }).setView([9.9, -84.1], 15);
  L.control.zoom({ position: 'bottomright' }).addTo(map);

  /* PANELES PARA JERARQUÍA: POLÍGONOS (abajo), LÍNEAS (medio), PUNTOS (arriba) */
  const polygonsPane = map.createPane('polygonsPane');
  polygonsPane.style.zIndex = 630;

  const linesPane = map.createPane('linesPane');
  linesPane.style.zIndex = 640;

  const pointsPane = map.createPane('pointsPane');
  pointsPane.style.zIndex = 650;

  /* MAPAS BASE */
  let currentBaseLayer = null;
  const baseLayers = {
    '🌿 Bosque (OSM claro)': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 20
    }),
    '🛰️ Satélite (Esri)': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Tiles © Esri',
      maxZoom: 19
    }),
    '🗺️ Topográfico (OpenTopoMap)': L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      attribution: 'Map data © OpenStreetMap contributors, SRTM | Map style: © OpenTopoMap',
      maxZoom: 17
    }),
    '📎 Fondo claro (Carto)': L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap contributors, © CARTO',
      maxZoom: 19
    })
  };

  currentBaseLayer = baseLayers['🌿 Bosque (OSM claro)'];
  currentBaseLayer.addTo(map);

  const basemapSelect = document.getElementById('basemap-select');
  Object.keys(baseLayers).forEach((nombre, idx) => {
    const opt = document.createElement('option');
    opt.value = nombre;
    opt.textContent = nombre;
    if (idx === 0) opt.selected = true;
    basemapSelect.appendChild(opt);
  });

  basemapSelect.addEventListener('change', (e) => {
    cambiarMapaBase(e.target.value);
  });

  function cambiarMapaBase(nombre) {
    if (currentBaseLayer) {
      map.removeLayer(currentBaseLayer);
    }
    currentBaseLayer = baseLayers[nombre];
    if (currentBaseLayer) {
      currentBaseLayer.addTo(map);
    }
  }

  const layerGroups = {};

  /* ORDEN DE CAPAS EN PANEL Y JERARQUÍA:
     - Primero PUNTOS
     - Luego LÍNEAS
     - Finalmente POLÍGONOS
  */
  const capas = [
    // PUNTOS
    'especies',
    'interes',
    'infraestructura',
    'reportes',
    // LÍNEAS
    'red_hidrica',
    'sendero',
    'curvas_nivel',
    // POLÍGONOS
    'reserva',
    'cuenca',
    'catastro'
  ];

  const allBounds = [];
  let searchMarker = null;
  let reporteMarker = null;
  let esperandoClickMapa = false;

  let especiesStats = { total: 0, porGrupo: {} };

  function normalizarGrupoEspecie(g) {
    if (!g) return "Sin grupo";
    let base = g.toString().trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    if (base.includes("plant")) return "Planta";
    if (base.includes("insect")) return "Insecto";
    if (base.includes("ave")) return "Ave";
    if (base.includes("mamif") || base.includes("manif")) return "Manifero";

    return g.toString().trim();
  }

  // Devuelve el pane según el tipo de capa para respetar jerarquía
  function obtenerPane(nombre) {
    const puntos = ['especies', 'interes', 'infraestructura', 'reportes'];
    const lineas = ['red_hidrica', 'sendero', 'curvas_nivel'];
    if (puntos.includes(nombre)) return 'pointsPane';
    if (lineas.includes(nombre)) return 'linesPane';
    return 'polygonsPane';
  }

  cargarCapas();

  document.getElementById('search-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      buscarEspecies();
    }
  });

  map.on('click', function(e) {
    if (esperandoClickMapa) {
      capturarUbicacionMapa(e.latlng.lat, e.latlng.lng);
    }
  });

  function abrirModalReporte() {
    document.getElementById('report-modal').classList.add('active');
  }

  function cerrarModalReporte() {
    document.getElementById('report-modal').classList.remove('active');
    document.getElementById('report-form').reset();
    document.getElementById('location-info').style.display = 'none';
    document.getElementById('report-lat').value = '';
    document.getElementById('report-lng').value = '';
    esperandoClickMapa = false;
    
    if (reporteMarker) {
      map.removeLayer(reporteMarker);
      reporteMarker = null;
    }
    
    map.getContainer().classList.remove('map-selecting');
  }

  function abrirModalEstadisticas() {
    document.getElementById('stats-modal').classList.add('active');
    actualizarPanelEstadisticas();
  }

  function cerrarModalEstadisticas() {
    document.getElementById('stats-modal').classList.remove('active');
  }

  function obtenerUbicacionGPS() {
    if (!navigator.geolocation) {
      alert('Tu navegador no soporta geolocalización');
      return;
    }

    const btn = event.target;
    const originalText = btn.textContent;
    btn.textContent = '📍 Obteniendo...';
    btn.disabled = true;

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        
        mostrarUbicacionCapturada(lat, lng, 'GPS');
        
        btn.textContent = '✓ Ubicación Capturada';
        btn.classList.add('active');
        btn.disabled = false;
      },
      (error) => {
        alert('Error al obtener la ubicación: ' + error.message);
        btn.textContent = originalText;
        btn.disabled = false;
      }
    );
  }

  function seleccionarEnMapa() {
    esperandoClickMapa = true;
    map.getContainer().classList.add('map-selecting');
    
    const modal = document.getElementById('report-modal');
    modal.style.opacity = '0.3';
    modal.style.pointerEvents = 'none';
    
    alert('Haz clic en el mapa donde deseas crear el reporte');
  }

  function capturarUbicacionMapa(lat, lng) {
    esperandoClickMapa = false;
    map.getContainer().classList.remove('map-selecting');
    
    const modal = document.getElementById('report-modal');
    modal.style.opacity = '1';
    modal.style.pointerEvents = 'auto';
    
    mostrarUbicacionCapturada(lat, lng, 'Mapa');
  }

  function mostrarUbicacionCapturada(lat, lng, metodo) {
    document.getElementById('report-lat').value = lat;
    document.getElementById('report-lng').value = lng;
    
    document.getElementById('location-text').innerHTML = `
      <b>Método:</b> ${metodo}<br>
      <b>Latitud:</b> ${lat.toFixed(6)}<br>
      <b>Longitud:</b> ${lng.toFixed(6)}
    `;
    document.getElementById('location-info').style.display = 'block';
    
    if (reporteMarker) {
      map.removeLayer(reporteMarker);
    }
    
    reporteMarker = L.marker([lat, lng], {
      icon: L.divIcon({
        className: 'reporte-marker',
        html: '<div style="background: radial-gradient(circle at 30% 30%, #ffecd4 0%, #ff6b35 55%, #9d0208 100%); width: 26px; height: 26px; border-radius: 50%; border: 3px solid white; box-shadow: 0 4px 12px rgba(0,0,0,0.5);"></div>',
        iconSize: [26, 26],
        iconAnchor: [13, 13]
      })
    }).addTo(map);

    map.setView([lat, lng], 18);
  }

  async function enviarReporte(event) {
    event.preventDefault();

    const nombre = document.getElementById('report-nombre').value;
    const tipo = document.getElementById('report-tipo').value;
    const comentario = document.getElementById('report-comentario').value;
    const lat = document.getElementById('report-lat').value;
    const lng = document.getElementById('report-lng').value;

    if (!lat || !lng) {
      alert('Por favor, captura una ubicación antes de enviar');
      return;
    }

    const submitBtn = event.target.querySelector('.btn-submit');
    submitBtn.textContent = 'Enviando...';
    submitBtn.disabled = true;

    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/crear_reporte`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`
        },
        body: JSON.stringify({
          p_nombre: nombre,
          p_tipo_requerimiento: tipo,
          p_comentario: comentario,
          p_latitud: parseFloat(lat),
          p_longitud: parseFloat(lng)
        })
      });

      if (!res.ok) throw new Error('Error al enviar el reporte');

      alert('¡Reporte enviado exitosamente!');
      cerrarModalReporte();
      await recargarReportes();

    } catch (err) {
      alert('Error al enviar el reporte: ' + err.message);
      submitBtn.textContent = 'Enviar Reporte';
      submitBtn.disabled = false;
    }
  }

  async function recargarReportes() {
    if (layerGroups['reportes']) {
      map.removeLayer(layerGroups['reportes']);
    }

    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/reportes?select=*`, {
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
      });
      
      if (res.ok) {
        const data = await res.json();
        if (data.length > 0) {
          agregarCapa('reportes', data);
          
          if (!document.getElementById('layer-reportes')) {
            crearControl('reportes');
          }
        }
      }
    } catch (err) {
      console.error('Error recargando reportes:', err);
    }
  }

  async function buscarEspecies() {
    const termino = document.getElementById('search-input').value.trim();
    const resultsDiv = document.getElementById('search-results');
    
    if (!termino) {
      resultsDiv.innerHTML = '<p style="color: #999; font-size: 12px;">Escribe algo para buscar</p>';
      return;
    }

    resultsDiv.innerHTML = '<p style="color: #999; font-size: 12px;">Buscando...</p>';

    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/buscar_especies`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`
        },
        body: JSON.stringify({ termino: termino })
      });

      if (!res.ok) throw new Error('Error en la búsqueda');
      
      const data = await res.json();
      
      if (data.length === 0) {
        resultsDiv.innerHTML = '<p style="color: #999; font-size: 12px;">No se encontraron resultados</p>';
        return;
      }

      resultsDiv.innerHTML = `<p style="color: #666; font-size: 11px; margin: 0 0 5px 0;">${data.length} resultado(s)</p>`;
      
      data.forEach(especie => {
        const div = document.createElement('div');
        div.className = 'result-item';
        div.innerHTML = `
          <strong>${especie.nombre_cie || 'Sin nombre científico'}</strong>
          <div class="species-details">
            <div><b>Nombre común:</b> ${especie.nombre_com || 'N/A'}</div>
            <div><b>Familia:</b> ${especie.familia || 'N/A'}</div>
            <div><b>Grupo:</b> ${especie.grupo || 'N/A'}</div>
            <div><b>Altitud:</b> ${especie.altitud || 'N/A'} m</div>
          </div>
        `;
        div.onclick = () => centrarEnEspecie(especie);
        resultsDiv.appendChild(div);
      });
      
    } catch (err) {
      resultsDiv.innerHTML = '<p style="color: #e53e3e; font-size: 12px;">Error: ' + err.message + '</p>';
    }
  }

  function centrarEnEspecie(especie) {
    if (!especie.latitud || !especie.longitud) {
      alert('Esta especie no tiene coordenadas');
      return;
    }

    const lat = parseFloat(especie.latitud);
    const lng = parseFloat(especie.longitud);
    
    if (searchMarker) {
      map.removeLayer(searchMarker);
    }
    
    searchMarker = L.marker([lat, lng], {
      icon: L.divIcon({
        className: 'search-marker',
        html: '<div style="background: linear-gradient(135deg, #FFD600 0%, #FFA500 100%); width: 26px; height: 26px; border-radius: 50%; border: 3px solid white; box-shadow: 0 4px 12px rgba(255, 165, 0, 0.7); animation: pulse 2s infinite;"></div><style>@keyframes pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.15); }}</style>',
        iconSize: [26, 26]
      })
    }).addTo(map);
    
    const popupContent = `
      <div style="padding: 8px;">
        <strong style="font-size: 16px; color: #1e5128;">${especie.nombre_cie || 'Sin nombre científico'}</strong><br>
        <div style="margin-top: 10px; line-height: 2;">
          <b style="color: #2d6a4f;">Nombre común:</b> ${especie.nombre_com || 'N/A'}<br>
          <b style="color: #2d6a4f;">Familia:</b> ${especie.familia || 'N/A'}<br>
          <b style="color: #2d6a4f;">Grupo:</b> ${especie.grupo || 'N/A'}<br>
          <b style="color: #2d6a4f;">Altitud:</b> ${especie.altitud || 'N/A'} m
        </div>
      </div>
    `;
    
    searchMarker.bindPopup(popupContent).openPopup();
    map.setView([lat, lng], 18);
  }

  async function cargarCapas() {
    const status = document.getElementById('status');
    const layersDiv = document.getElementById('layers-list');

    status.textContent = 'Cargando capas...';
    layersDiv.innerHTML = '';

    for (const capa of capas) {
      try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${capa}?select=*`, {
          headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
        });
        
        if (res.ok) {
          const data = await res.json();
          if (data.length > 0) {
            agregarCapa(capa, data);
            crearControl(capa);
          }
        }
      } catch (err) {
        console.error(`Error cargando ${capa}:`, err);
      }
    }

    status.textContent = `${Object.keys(layerGroups).length} capas cargadas`;
    
    if (allBounds.length > 0) {
      const bounds = L.latLngBounds(allBounds);
      map.fitBounds(bounds, { padding: [50, 50] });
    }
  }

  function agregarCapa(nombre, data) {
    const group = L.layerGroup();

    if (nombre === 'especies') {
      especiesStats.total = data.length;
      especiesStats.porGrupo = {};

      data.forEach(feature => {
        const grupoNorm = normalizarGrupoEspecie(feature.grupo);
        feature._grupo_normalizado = grupoNorm;
        especiesStats.porGrupo[grupoNorm] = (especiesStats.porGrupo[grupoNorm] || 0) + 1;
      });

      actualizarPanelEstadisticas();
    }
    
    data.forEach(feature => {
      if (!feature.geom) return;
      
      const geojson = typeof feature.geom === 'string' ? JSON.parse(feature.geom) : feature.geom;
      
      const geoLayerGroup = L.geoJSON(geojson, {
        style: obtenerEstilo(nombre),
        pane: obtenerPane(nombre),
        pointToLayer: (geoJsonPoint, latlng) => {
          return L.circleMarker(latlng, {
            pane: obtenerPane(nombre),
            radius: 6,
            fillColor: obtenerColor(nombre),
            color: '#000',
            weight: 1,
            opacity: 1,
            fillOpacity: 0.8
          });
        },
        onEachFeature: (geoFeature, geoLayer) => {
          if (nombre === 'especies') {
            geoLayer._grupo_normalizado = feature._grupo_normalizado || normalizarGrupoEspecie(feature.grupo);
          }

          let popupContent = '';
          
          if (nombre === 'especies') {
            popupContent = `
              <div style="padding: 5px; min-width: 200px;">
                <strong style="font-size: 15px; color: #1e5128;">🌿 ${feature['nombre com'] || feature.nombre_com || 'Especie sin nombre común'}</strong><br>
                <div style="margin-top: 8px; line-height: 1.8;">
                  <b style="color: #2d6a4f;">Nombre científico:</b> ${feature['nombre cie'] || feature.nombre_cie || 'N/A'}<br>
                  <b style="color: #2d6a4f;">Familia:</b> ${feature.familia || 'N/A'}<br>
                  <b style="color: #2d6a4f;">Grupo:</b> ${feature.grupo || 'N/A'}<br>
                  <b style="color: #2d6a4f;">Grupo (normalizado):</b> ${feature._grupo_normalizado || 'N/A'}<br>
                  <b style="color: #2d6a4f;">Altitud:</b> ${feature.altitud || 'N/A'} m
                </div>
              </div>
            `;
          } else if (nombre === 'interes') {
            popupContent = `
              <div style="padding: 5px; min-width: 200px;">
                <strong style="font-size: 15px; color: #1e5128;">📍 ${feature.name || 'Punto de Interés'}</strong><br>
                <div style="margin-top: 8px; line-height: 1.8;">
                  <b style="color: #2d6a4f;">Latitud:</b> ${feature.latitud || 'N/A'}<br>
                  <b style="color: #2d6a4f;">Longitud:</b> ${feature.longitud || 'N/A'}<br>
                  <b style="color: #2d6a4f;">Altitud:</b> ${feature.altitud || 'N/A'} m
                </div>
              </div>
            `;
          } else if (nombre === 'reportes') {
            const fecha = feature.fecha_reporte ? new Date(feature.fecha_reporte).toLocaleString('es-ES') : 'N/A';
            popupContent = `
              <div style="padding: 5px; min-width: 200px;">
                <strong style="font-size: 15px; color: #ff6b35;">📝 ${feature.tipo_requerimiento || 'Reporte'}</strong><br>
                <div style="margin-top: 8px; line-height: 1.8;">
                  <b style="color: #2d6a4f;">Reportado por:</b> ${feature.nombre || 'N/A'}<br>
                  <b style="color: #2d6a4f;">Fecha:</b> ${fecha}<br>
                  <b style="color: #2d6a4f;">Estado:</b> ${feature.estado || 'N/A'}<br>
                  <b style="color: #2d6a4f;">Comentario:</b><br>
                  <div style="padding: 5px; background: #f9f9f9; border-radius: 4px; margin-top: 5px;">
                    ${feature.comentario || 'Sin comentarios'}
                  </div>
                </div>
              </div>
            `;
          } else {
            const props = Object.entries(feature)
              .filter(([k, v]) => v !== null && v !== undefined && k !== 'geom' && k !== 'gid')
              .map(([k, v]) => `<b style="color: #2d6a4f;">${k}:</b> ${v}`)
              .join('<br>');
            if (props) {
              popupContent = `<div style="padding: 5px; min-width: 200px; line-height: 1.8;">${props}</div>`;
            }
          }
          
          if (popupContent) {
            geoLayer.bindPopup(popupContent);
          }

          /* Tooltips al pasar el mouse:
             - Especies: campo "nombre com" (o nombre_com)
             - Puntos de interés: campo "name"
          */
          if (nombre === 'especies') {
            const etiquetaEspecie =
              feature['nombre com'] ||
              feature.nombre_com ||
              feature['nombre cie'] ||
              feature.nombre_cie ||
              'Especie';
            geoLayer.bindTooltip(etiquetaEspecie, {
              direction: 'top',
              offset: [0, -8],
              permanent: false,
              sticky: true,
              className: 'custom-tooltip'
            });
          } else if (nombre === 'interes') {
            const etiquetaInteres = feature.name || 'Punto de interés';
            geoLayer.bindTooltip(etiquetaInteres, {
              direction: 'top',
              offset: [0, -8],
              permanent: false,
              sticky: true,
              className: 'custom-tooltip'
            });
          }
          
          if (geoLayer.getBounds) {
            const bounds = geoLayer.getBounds();
            allBounds.push(bounds.getNorthEast());
            allBounds.push(bounds.getSouthWest());
          } else if (geoLayer.getLatLng) {
            allBounds.push(geoLayer.getLatLng());
          }
        }
      });
      
      geoLayerGroup.addTo(group);
    });
    
    layerGroups[nombre] = group;
    group.addTo(map);
  }

  function crearControl(nombre) {
    const layersDiv = document.getElementById('layers-list');
    const div = document.createElement('div');
    div.className = 'layer-item';
    
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = true;
    checkbox.id = `layer-${nombre}`;
    checkbox.onchange = () => {
      if (checkbox.checked) {
        layerGroups[nombre].addTo(map);
      } else {
        map.removeLayer(layerGroups[nombre]);
      }
    };
    
    const label = document.createElement('label');
    label.htmlFor = `layer-${nombre}`;
    
    const info = obtenerInfoCapa(nombre);
    
    const iconSpan = document.createElement('span');
    iconSpan.className = 'layer-icon';
    iconSpan.textContent = info.icon;
    
    const nameSpan = document.createElement('span');
    nameSpan.className = 'layer-name';
    nameSpan.textContent = info.nombreVisible;
    
    const colorDot = document.createElement('span');
    colorDot.className = 'layer-color-dot';
    colorDot.style.backgroundColor = obtenerColor(nombre);
    
    label.appendChild(iconSpan);
    label.appendChild(nameSpan);
    label.appendChild(colorDot);
    
    div.appendChild(checkbox);
    div.appendChild(label);
    layersDiv.appendChild(div);
  }

  function obtenerEstilo(nombre) {
    return {
      color: obtenerColor(nombre),
      weight: 2,
      opacity: 0.8,
      fillOpacity: 0.4
    };
  }

  function obtenerColor(nombre) {
    const colores = {
      catastro: '#FF1744',
      cuenca: '#00B8D4',
      curvas_nivel: '#9E9E9E',
      especies: '#00E676',
      infraestructura: '#FF6D00',
      interes: '#FFD600',
      red_hidrica: '#2962FF',
      reserva: '#00C853',
      sendero: '#AA00FF',
      reportes: '#FF6B35'
    };
    return colores[nombre] || '#333';
  }

  function obtenerInfoCapa(nombre) {
    switch (nombre) {
      case 'reserva':
        return { icon: '🌲', nombreVisible: 'Reserva / Bosque' };
      case 'red_hidrica':
        return { icon: '💧', nombreVisible: 'Red hídrica' };
      case 'cuenca':
        return { icon: '🌊', nombreVisible: 'Cuenca hídrica' };
      case 'sendero':
        return { icon: '🥾', nombreVisible: 'Senderos' };
      case 'especies':
        return { icon: '🐾', nombreVisible: 'Especies registradas' };
      case 'interes':
        return { icon: '📍', nombreVisible: 'Puntos de interés' };
      case 'infraestructura':
        return { icon: '🏫', nombreVisible: 'Infraestructura' };
      case 'catastro':
        return { icon: '🏘️', nombreVisible: 'Catastro' };
      case 'curvas_nivel':
        return { icon: '⛰️', nombreVisible: 'Curvas de nivel' };
      case 'reportes':
        return { icon: '⚠️', nombreVisible: 'Reportes ciudadanos' };
      default:
        return { icon: '📄', nombreVisible: nombre };
    }
  }

  // Recorre todos los marcadores de especies (dentro de los GeoJSON)
  function forEachEspecieLayer(callback) {
    const group = layerGroups['especies'];
    if (!group) return;

    group.eachLayer(l => {
      if (typeof l.eachLayer === 'function' && !l.getLatLng) {
        l.eachLayer(inner => callback(inner));
      } else {
        callback(l);
      }
    });
  }

  function actualizarPanelEstadisticas() {
    const totalSpan = document.getElementById('stats-total');
    const tbody = document.getElementById('stats-grupos-body');
    const chipsDiv = document.getElementById('stats-chips');
    if (!totalSpan || !tbody || !chipsDiv) return;

    if (!especiesStats || especiesStats.total === 0) {
      totalSpan.textContent = 'Aún no se han cargado datos de especies';
      tbody.innerHTML = '<tr><td colspan="2">Sin datos</td></tr>';
      chipsDiv.innerHTML = '';
      return;
    }

    totalSpan.textContent = especiesStats.total + ' registros';

    const entries = Object.entries(especiesStats.porGrupo);
    entries.sort((a, b) => b[1] - a[1]);
    tbody.innerHTML = '';
    entries.forEach(([grupo, cantidad]) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${grupo}</td><td>${cantidad}</td>`;
      tbody.appendChild(tr);
    });

    chipsDiv.innerHTML = '';

    const chipAll = document.createElement('div');
    chipAll.className = 'stats-chip';
    chipAll.textContent = 'Mostrar todos';
    chipAll.onclick = () => {
      resetEstiloEspecies();
    };
    chipsDiv.appendChild(chipAll);

    entries.forEach(([grupo, cantidad]) => {
      const chip = document.createElement('div');
      chip.className = 'stats-chip';
      chip.textContent = `${grupo} (${cantidad})`;
      chip.onclick = () => {
        resaltarGrupo(grupo);
      };
      chipsDiv.appendChild(chip);
    });
  }

  function resetEstiloEspecies() {
    if (!layerGroups['especies']) return;

    forEachEspecieLayer(layer => {
      if (layer.setStyle) {
        layer.setStyle({
          radius: 6,
          fillColor: obtenerColor('especies'),
          color: '#000',
          weight: 1,
          opacity: 1,
          fillOpacity: 0.8
        });
      }
    });
  }

  function resaltarGrupo(grupoSeleccionado) {
    if (!layerGroups['especies']) return;

    const bounds = [];

    forEachEspecieLayer(layer => {
      const g = layer._grupo_normalizado || "Sin grupo";
      if (!layer.setStyle) return;

      if (g === grupoSeleccionado) {
        layer.setStyle({
          radius: 10,
          fillColor: "#00ff88",
          color: "#ffffff",
          weight: 3,
          fillOpacity: 1
        });
        if (layer.getLatLng) {
          bounds.push(layer.getLatLng());
        }
        if (layer.bringToFront) layer.bringToFront();
      } else {
        layer.setStyle({
          radius: 5,
          fillColor: "#999999",
          color: "#555555",
          weight: 1,
          fillOpacity: 0.2
        });
      }
    });

    if (bounds.length > 0) {
      const gBounds = L.latLngBounds(bounds);
      map.fitBounds(gBounds, { padding: [40, 40] });
    }
  }