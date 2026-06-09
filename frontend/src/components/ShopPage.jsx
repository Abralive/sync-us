import { STORE_ITEMS } from "../constants.js";

export default function ShopPage({ stardust }) {
  return (
    <section className="shop-page">
      <div className="shop-hero panel">
        <span className="garden-kicker">Stardust Shop</span>
        <h2>星塵補給站</h2>
        <p>把一起完成的事，換成小禮物、約會選擇權，或共享星域的裝飾。</p>
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
