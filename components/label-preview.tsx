/**
 * Anteprima dell'etichetta del cartone, impaginata come quella in uso (nome e codice, descrizione,
 * ingredienti, contenuto e peso, produttore, scadenza, lotto, identificativo, EAN).
 * Solo anteprima: nessun collegamento all'etichettatrice, che richiede modello e formato verificati.
 */
import { DEFAULT_SHELF_LIFE_MONTHS, type Product, type Settings } from '../lib/domain';

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const R = L.map(p => [...p].map(b => (b === '1' ? '0' : '1')).join(''));
const G = R.map(p => [...p].reverse().join(''));
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

/** Moduli (1 = barra) di un EAN-13 o EAN-8 già validato. */
export function eanBits(code: string): string {
  const d = [...code].map(Number);
  if (code.length === 8) return '101' + d.slice(0, 4).map(n => L[n]).join('') + '01010' + d.slice(4).map(n => R[n]).join('') + '101';
  const parity = PARITY[d[0]];
  return '101' + d.slice(1, 7).map((n, i) => (parity[i] === 'L' ? L : G)[n]).join('') + '01010' + d.slice(7).map(n => R[n]).join('') + '101';
}

function Barcode({ code }: { code: string }) {
  const bits = eanBits(code); const quiet = 9; const width = bits.length + quiet * 2;
  const guard = (i: number) => i < 3 || (i >= 45 && i < 50) || i >= bits.length - 3;
  return <svg className="label-barcode" viewBox={`0 0 ${width} 62`} role="img" aria-label={`Codice a barre EAN ${code}`} preserveAspectRatio="none">
    <rect width={width} height="62" fill="#fff"/>
    {[...bits].map((b, i) => b === '1' ? <rect key={i} x={quiet + i} y="0" width="1" height={code.length === 13 && guard(i) ? 56 : 50} fill="#000"/> : null)}
    {code.length === 13 && <text x="1" y="61" fontSize="9" fill="#000">{code[0]}</text>}
    <text x={quiet + (code.length === 13 ? 24 : 17)} y="61" fontSize="9" fill="#000" textAnchor="middle">{code.length === 13 ? code.slice(1, 7) : code.slice(0, 4)}</text>
    <text x={quiet + (code.length === 13 ? 71 : 50)} y="61" fontSize="9" fill="#000" textAnchor="middle">{code.length === 13 ? code.slice(7) : code.slice(4)}</text>
  </svg>;
}

const itDate = (day: string) => day ? day.split('-').reverse().join('/') : '';

export default function LabelPreview({ product, lotCode, expiry, settings, note = true }: { product: Partial<Product> & { code: string; name: string }; lotCode: string; expiry: string; settings?: Settings; note?: boolean }) {
  const net = product.piecesPerCarton && product.pieceWeightG ? product.piecesPerCarton * product.pieceWeightG : null;
  return <figure className="label-preview">
    <div className="carton-label" aria-label={`Anteprima etichetta ${product.name}`}>
      <div className="carton-label-head"><span className="carton-label-name">{product.name.toUpperCase()}</span><span className="carton-label-code">COD.{product.code}</span></div>
      {product.labelDescription && <p className="carton-label-small">{product.labelDescription}</p>}
      {product.ingredients && <p className="carton-label-tiny">{product.ingredients}</p>}
      {product.storage && <p className="carton-label-tiny">{product.storage}</p>}
      {product.piecesPerCarton ? <p className="carton-label-net">Contiene n {product.piecesPerCarton} pezzi{net ? ` peso netto ${new Intl.NumberFormat('it-IT').format(net)} g ℮` : ''}</p> : <p className="carton-label-missing">Pezzi e peso per cartone da indicare nella scheda prodotto</p>}
      {settings?.labelProducer && <p className="carton-label-small">{settings.labelProducer}</p>}
      <div className="carton-label-foot">
        <div className="carton-label-data">
          <span className="carton-label-tiny">Da consumarsi preferibilmente entro il</span>
          <span className="carton-label-date">{itDate(expiry)}</span>
          <span className="carton-label-lot">Lotto: {lotCode}</span>
          {settings?.labelIdent && <span className="carton-label-small">IDENT. {settings.labelIdent}</span>}
        </div>
        {product.ean ? <Barcode code={product.ean}/> : <span className="carton-label-missing">EAN da indicare nella scheda prodotto</span>}
      </div>
    </div>
    {note && <figcaption className="form-help">Anteprima indicativa: lotto = data di produzione (AAMMGG), scadenza = produzione + {product.shelfLifeMonths ?? DEFAULT_SHELF_LIFE_MONTHS} mesi. Non è collegata all’etichettatrice.</figcaption>}
  </figure>;
}
