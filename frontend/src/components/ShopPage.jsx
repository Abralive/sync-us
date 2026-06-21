import { STORE_ITEMS } from "../constants.js";

export default function ShopPage({ stardust }) {
  return (
    <section className="shop-page">
      <div className="shop-hero panel">
        <span className="garden-kicker">Stardust Shop</span>
        <h2>星塵補給站</h2>
        <p>把一起完成的泡泡，換成小小的共同獎勵。生活已經夠忙了，至少獎勵要可愛一點。</p>
        <strong>{stardust} 星塵</strong>
      </div>
      <div className="shop-grid">
        {STORE_ITEMS.map(([title, price, copy]) => (
          <article className="shop-item" key={title}>
            <span>{price}</span>
            <h3>{title}</h3>
            <p>{copy}</p>
            <button className="btn">兌換</button>
          </article>
        ))}
      </div>
    </section>
  );
}
