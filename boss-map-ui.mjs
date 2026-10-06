export async function showBossMap(container,name){
 const panel=document.createElement('section');panel.className='boss-map-panel';panel.innerHTML='<h3>Mapa dos locais de aparição</h3><p class="muted">Carregando localização…</p>';container.querySelector('h2').after(panel);
 try{
  const response=await fetch('/api/boss-maps?name='+encodeURIComponent(name));if(!response.ok)throw new Error('Mapa indisponível');const data=await response.json();
  panel.innerHTML='<h3>Mapa dos locais de aparição</h3><p class="muted">Locais do mapa do Tibia. Áreas e acessos podem variar no RubinOT.</p>';
  const locations=(data.locations||[]).filter(l=>l.coordinates&&['x','y','z'].every(k=>Number.isInteger(l.coordinates[k]))&&l.coordinates.x>=0&&l.coordinates.x<=65535&&l.coordinates.y>=0&&l.coordinates.y<=65535&&l.coordinates.z>=0&&l.coordinates.z<=15);
  if(!locations.length){panel.innerHTML+='<p>Localização ainda não confirmada para este boss.</p>';return;}
  const select=document.createElement('select');select.setAttribute('aria-label','Local de aparição');locations.forEach((l,i)=>{const option=document.createElement('option');option.value=i;const {x,y,z}=l.coordinates;option.textContent=`${l.name||'Local '+(i+1)} · ${x}, ${y}, andar ${z}`;select.append(option);});
  const frame=document.createElement('iframe');frame.className='boss-map';frame.title='Mapa de '+name;frame.loading='lazy';frame.referrerPolicy='no-referrer';
  const link=document.createElement('a');link.target='_blank';link.rel='noreferrer';link.textContent='Abrir mapa ampliado ↗';
  const update=()=>{const {x,y,z}=locations[Number(select.value)].coordinates;frame.src=`https://tibiamaps.io/map/embed#${x},${y},${z}:2`;link.href=`https://tibiamaps.io/map#${x},${y},${z}:2`;};
  select.onchange=update;panel.append(select,frame,link);update();
 }catch{panel.innerHTML='<h3>Mapa dos locais de aparição</h3><p>Mapa indisponível no momento. Tente novamente.</p>';}
}
