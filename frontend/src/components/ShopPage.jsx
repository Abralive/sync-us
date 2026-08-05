import { STORE_ITEMS } from "../constants.js";

export default function ShopPage({ stardust }) {
  return (
    <section className="shop-page">
      <div className="shop-hero panel">
        <span className="garden-kicker">商城</span>
        <h2>星塵補給站</h2>
        <p>把一起完成的事，換成一點真的會想兌換的小獎勵。</p>
        <strong>{stardust} 星塵</strong>
      </div>
      <div className="shop-grid">
        {STORE_ITEMS.map(([title, price, copy]) => {
          const cost = parseInt(price, 10) || 0;
          const affordable = stardust >= cost;
          return (
            <article className={`shop-item ${affordable ? "" : "locked"}`} key={title}>
              <span>{price}</span>
              <h3>{title}</h3>
              <p>{copy}</p>
              <button className="btn primary" disabled={!affordable} title={affordable ? "" : "星塵不足"}>
                {affordable ? "兌換" : `還差 ${cost - stardust} 星塵`}
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
