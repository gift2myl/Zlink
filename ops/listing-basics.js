// The listing projector binds officialOffer to this property's verified detail page.
const text = value => value == null ? '' : String(value).trim();
const esc = value => text(value).replace(/[&<>"']/g, char => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
})[char]);
const finite = value => typeof value === 'number' && Number.isFinite(value);

export function listingBasics(property = {}) {
  const id = text(property.realListingId);
  const sourceUrl = !property.imported && id === text(property.id) && /^\d+$/.test(id) && property.sourceUrl === `https://www.ziroom.com/x/${id}.html` ? property.sourceUrl : '';
  const offer = sourceUrl && property.officialOffer?.sourceUrl === sourceUrl ? property.officialOffer : null;
  const bedrooms = finite(property.bedrooms) && property.bedrooms > 0 ? `${property.bedrooms}居室` : '';
  const title = text(offer?.title) || text(property.listingLabel)
    || [property.name,bedrooms,property.roomLabel].filter(Boolean).join(' · ') || '房源资料';
  const isBedroom = property.areaScope === 'listed_bedroom';
  const areaLabel = text(property.areaLabel) || (isBedroom ? '卧室面积' : '房源面积');
  const area = text(property.areaDisplay) || (finite(property.area) && property.area > 0 ? property.area+'㎡' : '');
  const orientation = text(property.orientation);
  const floor = finite(property.floor) ? `${property.floor}${finite(property.totalFloors) ? '/'+property.totalFloors : '层'}` : '';
  return {
    title, sourceUrl, healthLabel:text(property.healthLabel) || '暂无匹配健康记录', signBadge:offer?.signBadge === true,
    monthlyRent:Number.isSafeInteger(offer?.monthlyRent) && offer.monthlyRent > 0 ? offer.monthlyRent : null,
    paymentLabel:text(offer?.paymentLabel), priceCondition:text(offer?.priceCondition),
    facts:[
      {label:isBedroom && !/卧室|房间/.test(areaLabel) ? '卧室'+areaLabel : areaLabel, value:area},
      {label:'朝向', value:/^[东西南北]+$/.test(orientation) ? '朝'+orientation : orientation},
      {label:isBedroom ? '所属户型' : '户型', value:text(property.layout) || bedrooms},
      {label:'楼层', value:floor}
    ]
  };
}

export function renderListingTitle({ title, signBadge }) {
  return (signBadge ? '<span class="geo-sign-badge">签</span>' : '') + esc(title);
}

export function renderListingOfferAndFacts({ monthlyRent, paymentLabel, priceCondition, sourceUrl, facts, healthLabel }, { inButton = false } = {}) {
  const tone = healthLabel?.match(/\bP[1-4]\b/)?.[0] || (healthLabel?.includes('健康房源') ? 'healthy' : 'unknown');
  const badge = `<span class="listing-health" data-grade="${tone}">${esc(healthLabel)}</span>`;
  let rent = sourceUrl ? '租金见官网' : '租金待核验';
  if (monthlyRent != null) {
    rent = `<strong data-geo-monthly-rent>¥${esc(monthlyRent)}<small> /月</small></strong>`;
  } else if (sourceUrl && !inButton) {
    rent = `<a data-geo-rent-source href="${esc(sourceUrl)}" target="_blank" rel="noopener noreferrer">租金见官网 ↗</a>`;
  }
  const payment = paymentLabel ? `<span data-geo-payment-label>（${esc(paymentLabel)}）</span>` : '';
  const condition = priceCondition && priceCondition !== paymentLabel ? `<span class="geo-price-condition">${esc(priceCondition)}</span>` : '';
  if (inButton) {
    const cells = facts.map(({label,value}) => `<span><span class="geo-fact-label">${esc(label)}</span><span class="geo-fact-value">${esc(value || '待核验')}</span></span>`).join('');
    return `${badge}<span class="geo-listing-rent">${rent}${payment}${condition}</span><span class="geo-listing-facts">${cells}</span>`;
  }
  const cells = facts.map(({label,value}) => `<div><dt>${esc(label)}</dt><dd>${esc(value || '待核验')}</dd></div>`).join('');
  return `${badge}<div class="geo-listing-rent">${rent}${payment}${condition}</div><dl class="geo-listing-facts">${cells}</dl>`;
}
