import { useState, useEffect, useRef, useCallback } from "react";
import "./index.css";
import { db } from "./firebase";
import {
  doc, getDoc, setDoc, collection,
  getDocs, deleteDoc, writeBatch
} from "firebase/firestore";

/* ═══════════════════════════════════════════
   ADMIN CONFIG — stored in env variables
═══════════════════════════════════════════ */
const ADMIN_PASSWORD    = process.env.REACT_APP_ADMIN_PASSWORD    || "desi@admin2024";
const ADMIN_SECRET_PATH = process.env.REACT_APP_ADMIN_SECRET      || "banarasi2024";

/* ═══════════════════════════════════════════
   DEFAULT SETTINGS
═══════════════════════════════════════════ */
const SEED_SETTINGS = {
  shopName:"Desi Style by Priyanshu",
  tagline:"Fabric that defines you",
  upiId:"", qr:null, whatsapp:"", phone:"", email:"",
  instagram:"desistylebypriyanshu",
  address:"Varanasi, Uttar Pradesh",
  catImages:{ Saree:null, Lehenga:null, Suit:null, Dupatta:null, Kurta:null },
  // Ad Banner settings
  adEnabled: false,        // master toggle — admin turns on/off
  adImage: null,           // product image for the ad
  adTitle: "",             // e.g. "Grand Sale — Up to 50% Off!"
  adSubtitle: "",          // e.g. "Limited time offer on Banarasi Sarees"
  adProductId: "",         // which product to link to on click
  adBadge: "SALE",         // badge text on the ad e.g. SALE / NEW / HOT
};

/* ═══════════════════════════════════════════
   FIREBASE DB LAYER
═══════════════════════════════════════════ */
const DB = {
  get: async (table) => {
    try {
      if (table === "settings") {
        const snap = await getDoc(doc(db, "settings", "main"));
        return snap.exists() ? snap.data() : null;
      } else {
        const snap = await getDocs(collection(db, table));
        if (snap.empty) return null;
        return snap.docs
          .map(d => d.data())
          .sort((a,b) => (b.createdAt||0) - (a.createdAt||0));
      }
    } catch(e) { console.error("DB.get:", e); return null; }
  },
  set: async (table, val) => {
    try {
      if (table === "settings") {
        await setDoc(doc(db, "settings", "main"), val);
      } else if (Array.isArray(val)) {
        const existing = await getDocs(collection(db, table));
        const bDel = writeBatch(db);
        existing.docs.forEach(d => bDel.delete(d.ref));
        await bDel.commit();
        for (let i = 0; i < val.length; i += 400) {
          const bWrite = writeBatch(db);
          val.slice(i, i+400).forEach(item => {
            bWrite.set(doc(db, table, String(item.id)), item);
          });
          await bWrite.commit();
        }
      }
      return true;
    } catch(e) {
      console.error("DB.set:", e);
      throw e; // surface the error to callers instead of silently failing
    }
  },
};

/* ═══════════════════════════════════════════
   IMAGE COMPRESSION HELPER
   Resizes + re-encodes images client-side so they stay small
   enough to store as base64 inside Firestore documents
   (Firestore has a hard 1MB-per-document limit).
═══════════════════════════════════════════ */
function compressImage(file, { maxWidth = 800, maxHeight = 800, quality = 0.7 } = {}) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;

        // scale down proportionally if larger than max dimensions
        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);

        // re-encode as JPEG at reduced quality — this is what shrinks file size
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        resolve(dataUrl);
      };
      img.onerror = () => reject(new Error("Could not load image"));
      img.src = ev.target.result;
    };
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

// rough byte-size estimate of a base64 data URL string
function estimateBase64Bytes(dataUrl) {
  const commaIdx = dataUrl.indexOf(",");
  const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
  return Math.round(base64.length * 0.75);
}

/* ═══════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════ */
const fmt  = n => "₹" + Number(n).toLocaleString("en-IN");
const disc = p => p.originalPrice ? Math.round((1 - p.price/p.originalPrice)*100) : 0;

/* ═══════════════════════════════════════════
   IMAGE UPLOADER  (now uploads to Firebase Storage)
═══════════════════════════════════════════ */
function ImageUploader({ current, onUpload, width=110, height=120, maxMB=5 }) {
  const ref = useRef();
  const [preview, setPreview] = useState(current);
  const [compressing, setCompressing] = useState(false);
  useEffect(() => setPreview(current), [current]);

  const handle = async e => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > maxMB*1024*1024) { alert(`Image must be under ${maxMB}MB`); return; }

    setCompressing(true);
    try {
      const compressed = await compressImage(file, { maxWidth: 800, maxHeight: 800, quality: 0.7 });
      const sizeKB = Math.round(estimateBase64Bytes(compressed) / 1024);
      if (sizeKB > 700) {
        // still too big — compress harder as a safety net
        const compressedAgain = await compressImage(file, { maxWidth: 600, maxHeight: 600, quality: 0.55 });
        setPreview(compressedAgain);
        onUpload(compressedAgain);
      } else {
        setPreview(compressed);
        onUpload(compressed);
      }
    } catch (err) {
      console.error("Image compression failed:", err);
      alert("Could not process this image. Please try a different photo.");
    } finally {
      setCompressing(false);
      if (ref.current) ref.current.value = ""; // allow re-selecting same file
    }
  };

  return (
    <div className="img-uploader" style={{ width, height, position:"relative" }} onClick={() => !compressing && ref.current.click()}>
      {compressing && (
        <div style={{ position:"absolute", inset:0, background:"rgba(255,255,255,0.85)", display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column", zIndex:2, fontSize:"0.7rem", color:"var(--crimson)", fontWeight:600 }}>
          <div style={{ fontSize:"1.4rem", marginBottom:4 }}>⏳</div>
          Processing...
        </div>
      )}
      {preview
        ? <img src={preview} alt="upload" style={{ width:"100%", height:"100%", objectFit:"cover" }}/>
        : <div style={{ textAlign:"center", color:"var(--muted)", padding:"0.5rem" }}>
            <div style={{ fontSize:"1.6rem", marginBottom:4 }}>📷</div>
            <div style={{ fontSize:"0.7rem" }}>Upload Photo</div>
            <div style={{ fontSize:"0.62rem", marginTop:2 }}>Max {maxMB}MB</div>
          </div>}
      <input ref={ref} type="file" accept="image/*" style={{ display:"none" }} onChange={handle}/>
    </div>
  );
}

/* ═══════════════════════════════════════════
   QR UPLOADER  (now uploads to Firebase Storage)
═══════════════════════════════════════════ */
function QRUploader({ current, onUpload }) {
  const ref = useRef();
  const [preview, setPreview] = useState(current);
  const [compressing, setCompressing] = useState(false);
  useEffect(() => setPreview(current), [current]);

  const handle = async e => {
    const file = e.target.files[0]; if (!file) return;

    setCompressing(true);
    try {
      // QR codes need to stay sharp — use higher quality/resolution than photos
      const compressed = await compressImage(file, { maxWidth: 500, maxHeight: 500, quality: 0.85 });
      setPreview(compressed);
      onUpload(compressed);
    } catch (err) {
      console.error("QR compression failed:", err);
      alert("Could not process this image. Please try a different photo.");
    } finally {
      setCompressing(false);
      if (ref.current) ref.current.value = "";
    }
  };

  return (
    <div>
      <div style={{ border:"2px dashed var(--border)", background:"var(--ivoryD)", padding:"1.5rem", textAlign:"center", cursor:"pointer", maxWidth:220, margin:"0 auto", position:"relative" }}
        onClick={() => !compressing && ref.current.click()}>
        {compressing && (
          <div style={{ position:"absolute", inset:0, background:"rgba(255,255,255,0.85)", display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column", fontSize:"0.78rem", color:"var(--crimson)", fontWeight:600 }}>
            <div style={{ fontSize:"1.6rem", marginBottom:4 }}>⏳</div>
            Processing...
          </div>
        )}
        {preview
          ? <img src={preview} alt="QR" style={{ width:150, height:150, objectFit:"contain" }}/>
          : <div style={{ color:"var(--muted)" }}>
              <div style={{ fontSize:"2.5rem" }}>📱</div>
              <div style={{ fontSize:"0.85rem", marginTop:8 }}>Click to upload your UPI QR</div>
            </div>}
        <input ref={ref} type="file" accept="image/*" style={{ display:"none" }} onChange={handle}/>
      </div>
      {preview && <p style={{ textAlign:"center", fontSize:"0.72rem", color:"var(--muted)", marginTop:6 }}>Click to change QR</p>}
    </div>
  );
}

/* ═══════════════════════════════════════════
   NOTIFICATION
═══════════════════════════════════════════ */
function Notif({ msg, show }) {
  return <div className={`notif${show?" show":""}`}>{msg}</div>;
}

/* ═══════════════════════════════════════════
   AD BANNER POPUP — shown to customers
═══════════════════════════════════════════ */
function AdBanner({ settings, onClose, onViewProduct }) {
  const { adImage, adTitle, adSubtitle, adBadge, adProductId } = settings;

  const handleClick = () => {
    if (adProductId) { onViewProduct(adProductId); }
    onClose();
  };

  return (
    <div className="ad-overlay" onClick={e => { if(e.target===e.currentTarget) onClose(); }}>
      <div className="ad-popup">
        {/* Close button */}
        <button className="ad-close" onClick={onClose} aria-label="Close">✕</button>

        {/* Sale badge */}
        {adBadge && <div className="ad-badge">{adBadge}</div>}

        {/* Product image */}
        {adImage
          ? <img
              src={adImage}
              alt={adTitle || "Sale"}
              className="ad-img"
              onClick={handleClick}
            />
          : <div className="ad-img-placeholder" onClick={handleClick}>
              <div style={{ fontSize:"3rem" }}>🏷️</div>
              <div style={{ color:"var(--goldL)", fontFamily:"'Cormorant Garamond',serif", fontSize:"1.1rem" }}>Special Offer</div>
              <div style={{ color:"rgba(232,201,122,0.6)", fontSize:"0.8rem" }}>Click to view product</div>
            </div>}

        {/* Bottom info */}
        <div className="ad-body">
          {adTitle && <div className="ad-title">{adTitle}</div>}
          {adSubtitle && <div className="ad-sub">{adSubtitle}</div>}
          <button className="ad-cta" onClick={handleClick}>
            {adProductId ? "Shop Now →" : "Explore Collection"}
          </button>
          <button className="ad-dismiss" onClick={onClose}>No thanks, continue browsing</button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   PRODUCT CARD
═══════════════════════════════════════════ */
function ProductCard({ p, onView, onAddCart }) {
  const d = disc(p);
  const oos = p.stock === 0;
  return (
    <div className="product-card">
      <div className="product-img-wrap" onClick={() => onView(p)}>
        {p.image ? <img src={p.image} alt={p.name}/> : <div className="product-emoji">{p.emoji||"🥻"}</div>}
        {p.onSale && <div className="sale-badge">🔥 SALE</div>}
        {!p.onSale && d > 0 && <div className="disc-badge">{d}% OFF</div>}
        {oos && <div className="product-oos-overlay"><span className="product-oos-label">OUT OF STOCK</span></div>}
      </div>
      <div className="product-body">
        <div className="product-fabric">{p.fabric}</div>
        <div className="product-name" onClick={() => onView(p)}>{p.name}</div>
        <div className="product-price-row">
          <span className="price-main">{fmt(p.price)}</span>
          {p.originalPrice && <span className="price-old">{fmt(p.originalPrice)}</span>}
        </div>
        <div className={`stock-label ${oos?"stock-out":p.stock<5?"stock-low":"stock-ok"}`}>
          {oos ? "Out of Stock" : p.stock<5 ? `Only ${p.stock} left!` : "In Stock"}
        </div>
        <button className="btn-primary btn-full" style={{ padding:"0.58rem", fontSize:"0.82rem" }}
          disabled={oos} onClick={() => onAddCart(p)}>
          {oos ? "Out of Stock" : "Add to Bag"}
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   ORDERS TABLE
═══════════════════════════════════════════ */
function OrdersTable({ orders, onUpdateStatus }) {
  const cls = { pending:"badge-pending", processing:"badge-processing", shipped:"badge-shipped", delivered:"badge-delivered", cancelled:"badge-cancelled" };
  if (!orders.length) return <div className="empty"><p>No orders found.</p></div>;
  return (
    <div style={{ overflowX:"auto" }}>
      <table className="data-table">
        <thead>
          <tr>{["Order ID","Customer & Address","Items","Total","Payment","Status",...(onUpdateStatus?["Update Status"]:[])].map(h=><th key={h}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {orders.map(o=>(
            <tr key={o.id}>
              <td style={{ fontFamily:"'Cormorant Garamond',serif", fontWeight:700, color:"var(--crimson)", whiteSpace:"nowrap" }}>{o.id}</td>
              <td style={{ minWidth:200 }}>
                <div style={{ fontWeight:700, color:"var(--textDark)" }}>{o.customer}</div>
                <div style={{ fontSize:"0.75rem", color:"var(--muted)", marginTop:1 }}>📞 {o.phone}</div>
                {o.address && <div style={{ fontSize:"0.75rem", color:"var(--textMid)", marginTop:4, lineHeight:1.5, background:"var(--ivoryD)", padding:"0.3rem 0.5rem", borderLeft:"2px solid var(--gold)", maxWidth:220 }}>📍 {o.address}</div>}
              </td>
              <td style={{ minWidth:160 }}>{o.items.map((i,idx)=><div key={idx} style={{ fontSize:"0.8rem" }}>{i.name} ×{i.qty}{i.color?` · ${i.color}`:""}{i.size?` / ${i.size}`:""}</div>)}</td>
              <td style={{ fontWeight:700, color:"var(--crimson)", whiteSpace:"nowrap" }}>{fmt(o.total)}</td>
              <td style={{ fontSize:"0.82rem" }}>{o.paymentMethod}</td>
              <td><span className={`badge ${cls[o.status]||""}`}>{o.status}</span></td>
              {onUpdateStatus && (
                <td>
                  <select defaultValue={o.status} onChange={e=>onUpdateStatus(o.id,e.target.value)}
                    style={{ border:"1px solid var(--border)", background:"var(--ivory)", padding:"0.22rem 0.4rem", fontSize:"0.78rem", cursor:"pointer" }}>
                    {["pending","processing","shipped","delivered","cancelled"].map(s=>(
                      <option key={s} value={s}>{s.charAt(0).toUpperCase()+s.slice(1)}</option>
                    ))}
                  </select>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ═══════════════════════════════════════════
   HEADER
═══════════════════════════════════════════ */
function Header({ view, setView, shopPage, setShopPage, adminTab, setAdminTab, cartCount, settings, mobileMenuOpen, setMobileMenuOpen, isAdminSession }) {
  const go = page => { setShopPage(page); setMobileMenuOpen(false); window.scrollTo(0,0); };
  return (
    <header className="header">
      <div className="header-inner">
        <div onClick={() => { setView("shop"); go("home"); }} style={{ cursor:"pointer", flexShrink:0, display:"flex", alignItems:"center", gap:"0.6rem" }}>
          <img src="/logo.jpeg" alt="logo" style={{ width:40, height:40, borderRadius:"50%", objectFit:"cover", border:"2px solid var(--gold)", flexShrink:0 }}/>
          <div>
            <div className="logo-name">Desi Style by Priyanshu</div>
            <div className="logo-tag">{settings.tagline}</div>
          </div>
        </div>
        <nav className="nav">
          {view==="shop" && <>
            <button className={`nav-btn${shopPage==="home"?" active":""}`} onClick={()=>go("home")}>Home</button>
            <button className={`nav-btn${shopPage==="products"?" active":""}`} onClick={()=>go("products")}>Collections</button>
            <button className={`nav-btn${shopPage==="myorders"?" active":""}`} onClick={()=>go("myorders")}>My Orders</button>
          </>}
          {view==="admin" && ["dashboard","products","orders","settings"].map(t=>(
            <button key={t} className={`nav-btn${adminTab===t?" active":""}`}
              onClick={()=>{ setAdminTab(t); setMobileMenuOpen(false); }}>
              {t.charAt(0).toUpperCase()+t.slice(1)}
            </button>
          ))}
        </nav>
        <div className="header-actions">
          {view==="shop" && (
            <button className="cart-btn" onClick={()=>go("cart")}>
              🛒{cartCount>0&&<span className="cart-badge">{cartCount}</span>}
            </button>
          )}
          {isAdminSession && (
            <button className={`admin-toggle${view==="admin"?" active":""}`}
              onClick={()=>{ setView(v=>v==="shop"?"admin":"shop"); setMobileMenuOpen(false); }}>
              {view==="admin" ? "← Store" : "⚙ Admin"}
            </button>
          )}
          {isAdminSession && view==="admin" && (
            <button className="admin-toggle" style={{ borderColor:"#C62828", color:"#C62828" }}
              onClick={()=>{ sessionStorage.removeItem("dsp_admin_auth"); window.location.href=window.location.pathname; }}>
              Logout
            </button>
          )}
          <button className="menu-btn" onClick={()=>setMobileMenuOpen(o=>!o)}>☰</button>
        </div>
      </div>
      <div className={`mobile-nav${mobileMenuOpen?" open":""}`}>
        {view==="shop" && <>
          <button className={`nav-btn${shopPage==="home"?" active":""}`} onClick={()=>go("home")}>Home</button>
          <button className={`nav-btn${shopPage==="products"?" active":""}`} onClick={()=>go("products")}>Collections</button>
          <button className={`nav-btn${shopPage==="myorders"?" active":""}`} onClick={()=>go("myorders")}>My Orders</button>
          <button className="nav-btn" onClick={()=>go("cart")}>🛒 Cart ({cartCount})</button>
        </>}
        {view==="admin" && ["dashboard","products","orders","settings"].map(t=>(
          <button key={t} className={`nav-btn${adminTab===t?" active":""}`}
            onClick={()=>{ setAdminTab(t); setMobileMenuOpen(false); }}>
            {t.charAt(0).toUpperCase()+t.slice(1)}
          </button>
        ))}
      </div>
    </header>
  );
}

/* ═══════════════════════════════════════════
   ADMIN LOGIN
═══════════════════════════════════════════ */
function AdminLogin({ onSuccess }) {
  const [pw, setPw]     = useState("");
  const [err, setErr]   = useState(false);
  const [show, setShow] = useState(false);
  const attempt = () => {
    if (pw === ADMIN_PASSWORD) { sessionStorage.setItem("dsp_admin_auth","1"); onSuccess(); }
    else { setErr(true); setPw(""); setTimeout(()=>setErr(false),2000); }
  };
  return (
    <div style={{ minHeight:"100vh", background:"var(--deep)", display:"flex", alignItems:"center", justifyContent:"center", padding:"1rem" }}>
      <div style={{ background:"var(--ivory)", border:"2px solid var(--gold)", padding:"2.5rem 2rem", width:"100%", maxWidth:380, textAlign:"center" }}>
        <img src="/logo.jpeg" alt="logo" style={{ width:80, height:80, borderRadius:"50%", objectFit:"cover", border:"3px solid var(--gold)", margin:"0 auto 1.2rem" }}/>
        <div style={{ fontFamily:"'Cormorant Garamond',serif", fontSize:"1.5rem", color:"var(--crimson)", fontWeight:700, letterSpacing:2 }}>Admin Access</div>
        <p style={{ fontSize:"0.82rem", color:"var(--muted)", margin:"0.5rem 0 1.5rem" }}>Enter your admin password to continue</p>
        <div style={{ position:"relative", marginBottom:"1rem" }}>
          <input type={show?"text":"password"} className="form-input"
            placeholder="Enter admin password" value={pw}
            onChange={e=>setPw(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&attempt()}
            style={{ borderColor:err?"#C62828":undefined, paddingRight:"2.8rem", textAlign:"center", letterSpacing:2 }} autoFocus/>
          <button onClick={()=>setShow(s=>!s)}
            style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", color:"var(--muted)", cursor:"pointer", fontSize:"1rem" }}>
            {show?"🙈":"👁"}
          </button>
        </div>
        {err && <div style={{ background:"#FFEBEE", border:"1px solid #EF9A9A", color:"#C62828", padding:"0.5rem 0.8rem", fontSize:"0.82rem", marginBottom:"1rem" }}>❌ Incorrect password</div>}
        <button className="btn-primary btn-full" style={{ padding:"0.85rem", fontSize:"1rem" }} onClick={attempt}>Enter Dashboard</button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   SHOP — HOME
═══════════════════════════════════════════ */
function ShopHome({ activeProducts, products, orders, settings, onGoProducts, onViewProduct, onAddCart }) {
  const cats   = [{name:"Saree"},{name:"Lehenga"},{name:"Suit"},{name:"Dupatta"},{name:"Kurta"}];
  const ticker = ["Pure Banarasi Silk","Handwoven Zari","Free Shipping ₹3000+","Authentic Heritage","Gift Packaging","Handcrafted with Love"];
  const doubled = [...ticker,...ticker];

  const catIcons = { Saree:"🥻", Lehenga:"👘", Suit:"👗", Dupatta:"🧣", Kurta:"👔" };

  return (
    <div>
      {/* Hero */}
      <section className="hero">
        <div className="hero-pattern"/>
        <div className="hero-content" style={{ display:"flex", flexDirection:"column", alignItems:"center" }}>
          <div style={{ marginBottom:"2rem" }}>
            <div style={{ position:"relative", borderRadius:10, overflow:"hidden", lineHeight:0, boxShadow:"0 24px 70px rgba(0,0,0,0.6), 0 6px 20px rgba(0,0,0,0.4)" }}>
              <img src="/logo.jpeg" alt="Desi Style by Priyanshu"
                style={{ display:"block", width:"clamp(220px,34vw,300px)", height:"auto", objectFit:"contain", objectPosition:"top center", borderRadius:10, filter:"brightness(1.06) contrast(1.03) saturate(1.08)" }}/>
              <div style={{ position:"absolute", bottom:0, left:0, right:0, height:"28%", background:"linear-gradient(to top, rgba(92,0,0,0.45), transparent)", pointerEvents:"none" }}/>
              <div style={{ position:"absolute", inset:0, background:"linear-gradient(135deg, rgba(255,255,255,0.06) 0%, transparent 40%)", pointerEvents:"none" }}/>
            </div>
          </div>
          {/* Brand text */}
          <div style={{ fontFamily:"'Cormorant Garamond',serif", fontSize:"clamp(2rem,5vw,3.2rem)", fontWeight:700, color:"var(--ivory)", letterSpacing:"0.12em", lineHeight:1, textAlign:"center", marginBottom:"0.15rem", textShadow:"0 2px 20px rgba(201,168,76,0.25)" }}>Desi Style</div>
          <div style={{ fontFamily:"'Cormorant Garamond',serif", fontSize:"clamp(0.95rem,2vw,1.15rem)", color:"var(--gold)", letterSpacing:"0.35em", textTransform:"uppercase", marginBottom:"1rem", fontStyle:"italic", opacity:0.9 }}>by Priyanshu</div>
          <p className="hero-sub" style={{ marginTop:0 }}>Handcrafted silk, zari work &amp; timeless elegance — from the ghats to your closet</p>
          <div className="hero-btns">
            <button className="btn-primary" onClick={()=>onGoProducts("")}>Explore Collection</button>
            <button className="btn-outline-ivory" onClick={()=>onGoProducts("")}>View All</button>
          </div>
          {/* Tagline */}
          <div style={{ marginTop:"1.1rem", fontFamily:"'Cormorant Garamond',serif", fontSize:"clamp(0.85rem,1.8vw,1rem)", color:"var(--goldL)", letterSpacing:"0.28em", textTransform:"uppercase", fontStyle:"italic", opacity:0.85 }}>
            Fabric that defines you
          </div>
        </div>
      </section>

      {/* Marquee */}
      <div className="marquee-wrap">
        <div className="marquee-inner">{doubled.map((t,i)=><span key={i} className="marquee-item">✦ {t}</span>)}</div>
      </div>

      {/* Categories */}
      <div className="section">
        <h2 className="section-title">Shop by Category</h2>
        <p className="section-sub">From bridal silks to everyday elegance</p>
        <div className="ornament"><div className="ornament-line"/><div className="ornament-diamond"/><div className="ornament-line"/></div>
        <div className="cat-grid">
          {cats.map(c=>{
            const uploadedImg = settings?.catImages?.[c.name];
            return (
              <div key={c.name} className="cat-card" onClick={()=>onGoProducts(c.name)}>
                <div style={{ display:"flex", justifyContent:"center", alignItems:"center", height:80, marginBottom:"0.5rem" }}>
                  {uploadedImg
                    ? <img src={uploadedImg} alt={c.name} style={{ width:72, height:72, objectFit:"cover", borderRadius:8, boxShadow:"0 4px 12px rgba(139,0,0,0.18)", border:"2px solid var(--border)" }}/>
                    : <div style={{ fontSize:"2.8rem" }}>{catIcons[c.name]}</div>}
                </div>
                <div className="cat-name">{c.name}s</div>
                <div className="cat-count">{activeProducts.filter(p=>p.category===c.name).length} styles</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Featured */}
      <div className="section-bg">
        <div className="section">
          <h2 className="section-title">Featured Collection</h2>
          <p className="section-sub">Bestsellers this season</p>
          <div className="ornament"><div className="ornament-line"/><div className="ornament-diamond"/><div className="ornament-line"/></div>
          <div className="product-grid">
            {activeProducts.slice(0,4).map(p=><ProductCard key={p.id} p={p} onView={onViewProduct} onAddCart={onAddCart}/>)}
          </div>
          <div style={{ textAlign:"center", marginTop:"2rem" }}>
            <button className="btn-primary" onClick={()=>onGoProducts("")}>View All Collections</button>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))", gap:"1rem", padding:"3rem 1.5rem", maxWidth:1100, margin:"0 auto" }}>
        {[["200+","Artisan Weavers"],[`${products.length}+`,"Products"],[`${orders.length}+`,"Orders Fulfilled"],["GI","Tagged Products"]].map(([v,l])=>(
          <div key={l} style={{ background:"var(--ivoryD)", border:"1px solid var(--border)", padding:"1.8rem", textAlign:"center" }}>
            <div style={{ fontFamily:"'Cormorant Garamond',serif", fontSize:"2.6rem", fontWeight:700, color:"var(--crimson)" }}>{v}</div>
            <div style={{ fontSize:"0.8rem", color:"var(--muted)", letterSpacing:1, marginTop:4 }}>{l}</div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <footer className="footer">
        <div className="footer-inner">
          <div>
            <div style={{ display:"flex", alignItems:"center", gap:"0.6rem", marginBottom:6 }}>
              <img src="/logo.jpeg" alt="logo" style={{ width:36, height:36, borderRadius:"50%", objectFit:"cover", border:"2px solid var(--gold)" }}/>
              <div className="logo-name" style={{ color:"var(--gold)" }}>Desi Style by Priyanshu</div>
            </div>
            <div className="logo-tag" style={{ marginBottom:10 }}>{settings.tagline}</div>
            <p style={{ fontSize:"0.82rem", color:"rgba(253,248,239,.6)", lineHeight:1.7, maxWidth:220 }}>Bringing the authentic heritage of Banarasi weaving to your doorstep.</p>
          </div>
          <div>
            <div className="footer-heading">Collections</div>
            {["Sarees","Lehengas","Suits","Dupattas","Kurtas"].map(c=><div key={c} className="footer-link">{c}</div>)}
          </div>
          <div>
            <div className="footer-heading">Contact</div>
            {settings.whatsapp && <div className="footer-link">📱 WhatsApp: +91 {settings.whatsapp}</div>}
            {settings.phone    && <div className="footer-link">📞 Call: +91 {settings.phone}</div>}
            {settings.email    && <div className="footer-link">✉️ {settings.email}</div>}
            {settings.instagram&& <div className="footer-link">📸 @{settings.instagram}</div>}
            <div className="footer-link" style={{ marginTop:6 }}>Track My Order</div>
          </div>
        </div>
        <div className="footer-bottom">© 2024 {settings.shopName} · Made with ❤ in Varanasi · All rights reserved</div>
      </footer>

      {/* Floating WhatsApp */}
      {settings.whatsapp && (
        <a href={`https://wa.me/91${(settings.whatsapp||"").replace(/\D/g,"")}?text=${encodeURIComponent("Hi! I visited Desi Style by Priyanshu website and need help.")}`}
          target="_blank" rel="noreferrer"
          style={{ position:"fixed", bottom:24, right:24, width:58, height:58, borderRadius:"50%", background:"#25D366", display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 4px 20px rgba(37,211,102,0.5)", zIndex:300, textDecoration:"none", animation:"waPulse 2.5s ease-in-out infinite" }}
          title="Chat with us on WhatsApp">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="32" height="32">
            <path fill="#fff" d="M4.9 43.3l2.7-9.9C5.5 30.8 4.5 27.5 4.5 24 4.5 13.2 13.2 4.5 24 4.5S43.5 13.2 43.5 24 34.8 43.5 24 43.5c-3.4 0-6.6-.9-9.4-2.6L4.9 43.3z"/>
            <path fill="#25D366" d="M24 7.5C14.8 7.5 7.5 14.8 7.5 24c0 3.2.9 6.3 2.5 8.9l.5.8-2 7.5 7.7-2 .8.4c2.5 1.5 5.4 2.4 8.5 2.4C33.2 42 40.5 34.7 40.5 24S33.2 6 24 6z"/>
            <path fill="#fff" fillRule="evenodd" d="M19.3 16c-.4-.9-.8-.9-1.1-.9h-1c-.3 0-.9.1-1.3.6-.5.5-1.8 1.7-1.8 4.2s1.8 4.9 2.1 5.2c.3.4 3.5 5.6 8.6 7.6 4.3 1.7 5.1 1.4 6 1.3.9-.1 2.9-1.2 3.3-2.3.4-1.1.4-2.1.3-2.3-.1-.2-.5-.3-1-.6s-2.9-1.4-3.4-1.6c-.5-.2-.8-.3-1.2.3-.4.5-1.4 1.6-1.7 1.9-.3.4-.7.4-1.2.1-.5-.3-2.1-.8-4-2.5-1.5-1.3-2.4-2.9-2.7-3.4-.3-.5 0-.8.2-1.1.2-.2.5-.6.7-.9.2-.3.3-.5.5-.9.2-.4.1-.7 0-1z"/>
          </svg>
        </a>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════
   SHOP — PRODUCTS
═══════════════════════════════════════════ */
function ShopProducts({ activeProducts, initialCat, onViewProduct, onAddCart }) {
  const [cat,  setCat]  = useState(initialCat||"");
  const [sort, setSort] = useState("featured");
  const cats = ["","Saree","Lehenga","Suit","Dupatta","Kurta"];
  let list = activeProducts.filter(p=>!cat||p.category===cat);
  if (sort==="price-low")  list=[...list].sort((a,b)=>a.price-b.price);
  if (sort==="price-high") list=[...list].sort((a,b)=>b.price-a.price);
  return (
    <div>
      <div className="page-banner"><h1>Our Collections</h1><p>Home · Collections</p></div>
      <div className="section" style={{ paddingTop:"1.5rem" }}>
        <div style={{ display:"flex", gap:"0.6rem", flexWrap:"wrap", marginBottom:"1rem", alignItems:"center", justifyContent:"space-between" }}>
          <div style={{ display:"flex", gap:"0.4rem", flexWrap:"wrap" }}>
            {cats.map(c=>(
              <button key={c} className="btn-sm"
                style={{ background:cat===c?"var(--crimson)":"var(--ivoryD)", color:cat===c?"#fff":"var(--textMid)", border:"1px solid var(--border)" }}
                onClick={()=>setCat(c)}>{c||"All"}</button>
            ))}
          </div>
          <select value={sort} onChange={e=>setSort(e.target.value)} className="form-input" style={{ width:180 }}>
            <option value="featured">Featured</option>
            <option value="price-low">Price: Low → High</option>
            <option value="price-high">Price: High → Low</option>
          </select>
        </div>
        <div style={{ fontSize:"0.85rem", color:"var(--muted)", marginBottom:"1rem" }}>{list.length} product{list.length!==1?"s":""}</div>
        {list.length===0
          ? <div className="empty"><div className="empty-icon">🔍</div><h3>No Products Found</h3><p>Try a different category.</p></div>
          : <div className="product-grid">{list.map(p=><ProductCard key={p.id} p={p} onView={onViewProduct} onAddCart={onAddCart}/>)}</div>}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   SHOP — DETAIL
═══════════════════════════════════════════ */
function ShopDetail({ product, onAddCart, onGoCart }) {
  const [qty, setQty] = useState(1);
  const [mainImg, setMainImg] = useState(null);
  const p = product;
  if (!p) return null;
  const d = disc(p);
  const images = [p.image, ...(p.extraImages||[])].filter(Boolean);
  const displayImg = mainImg || images[0] || null;

  return (
    <div>
      <div className="page-banner" style={{ padding:"1.2rem 1.5rem" }}><p>Home · Collections · {p.name}</p></div>
      <div className="detail-layout">
        <div>
          <div className="detail-main-img" style={{ position:"relative" }}>
            {displayImg ? <img src={displayImg} alt={p.name}/> : <div style={{ fontSize:"6.5rem" }}>{p.emoji||"🥻"}</div>}
            {p.onSale && <div style={{ position:"absolute", top:12, left:12, background:"#E65100", color:"#fff", fontFamily:"'Cormorant Garamond',serif", fontSize:"0.9rem", fontWeight:700, padding:"0.4rem 0.8rem", letterSpacing:1 }}>🔥 ON SALE</div>}
          </div>
          {images.length > 1 && (
            <div style={{ display:"flex", gap:"0.5rem", marginTop:"0.6rem", flexWrap:"wrap" }}>
              {images.map((img,i)=>(
                <div key={i} onClick={()=>setMainImg(img)}
                  style={{ width:60, height:66, border:`2px solid ${displayImg===img?"var(--crimson)":"var(--border)"}`, overflow:"hidden", cursor:"pointer", flexShrink:0 }}>
                  <img src={img} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }}/>
                </div>
              ))}
            </div>
          )}
        </div>
        <div>
          <div className="detail-category">{p.category} · {p.fabric}</div>
          <h1 className="detail-name">{p.name}</h1>
          <div style={{ display:"flex", alignItems:"baseline", gap:10, marginBottom:"0.8rem", flexWrap:"wrap" }}>
            <span className="detail-price">{fmt(p.price)}</span>
            {p.originalPrice && <>
              <span style={{ fontSize:"1rem", color:"var(--muted)", textDecoration:"line-through" }}>{fmt(p.originalPrice)}</span>
              <span style={{ background:p.onSale?"#E65100":"var(--crimson)", color:"#fff", fontSize:"0.72rem", padding:"0.15rem 0.45rem", fontWeight:700 }}>{p.onSale?"🔥 SALE":disc(p)+"% OFF"}</span>
            </>}
          </div>
          <p className="detail-desc">{p.desc}</p>
          <div className={`stock-label ${p.stock===0?"stock-out":p.stock<5?"stock-low":"stock-ok"}`} style={{ marginBottom:"1rem" }}>
            {p.stock===0?"❌ Out of Stock":p.stock<5?`⚠ Only ${p.stock} left!`:`✓ In Stock (${p.stock} available)`}
          </div>
          {/* Colors */}
          {p.colors && p.colors.trim() && (
            <div style={{ marginBottom:"0.8rem" }}>
              <div className="form-label">Available Colors</div>
              <div style={{ display:"flex", gap:"0.4rem", flexWrap:"wrap" }}>
                {p.colors.split(",").map(c=>c.trim()).filter(Boolean).map(c=>(
                  <span key={c} style={{ padding:"0.3rem 0.7rem", border:"1px solid var(--border)", fontSize:"0.82rem", background:"var(--ivoryD)", color:"var(--textMid)" }}>{c}</span>
                ))}
              </div>
            </div>
          )}
          {/* Sizes */}
          {p.sizes && p.sizes.trim() && (
            <div style={{ marginBottom:"1rem" }}>
              <div className="form-label">Available Sizes</div>
              <div style={{ display:"flex", gap:"0.4rem", flexWrap:"wrap" }}>
                {p.sizes.split(",").map(s=>s.trim()).filter(Boolean).map(s=>(
                  <span key={s} style={{ padding:"0.3rem 0.7rem", border:"1px solid var(--border)", fontSize:"0.82rem", background:"var(--ivoryD)", color:"var(--textMid)" }}>{s}</span>
                ))}
              </div>
            </div>
          )}
          <div style={{ display:"flex", alignItems:"center", gap:"1rem", marginBottom:"1.2rem" }}>
            <span className="form-label" style={{ margin:0 }}>Qty</span>
            <div className="qty-ctrl">
              <button className="qty-btn" onClick={()=>setQty(q=>Math.max(1,q-1))}>−</button>
              <div className="qty-display">{qty}</div>
              <button className="qty-btn" onClick={()=>setQty(q=>Math.min(p.stock,q+1))}>+</button>
            </div>
          </div>
          <button className="btn-primary" style={{ width:"100%", padding:"0.85rem" }}
            disabled={p.stock===0} onClick={()=>{ onAddCart(p,qty); onGoCart(); }}>
            Add to Bag & View Cart
          </button>
          <div className="detail-features">
            {["🚚 Free shipping on orders above ₹3,000","🎁 Complimentary gift packaging","📱 Pay via UPI QR Code"].map(f=>(
              <div key={f} className="feat-row"><span className="feat-icon">✦</span>{f}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   SHOP — CART
═══════════════════════════════════════════ */
function ShopCart({ cart, setCart, onGoProducts, onGoCheckout, toast }) {
  const sub = cart.reduce((s,i)=>s+i.price*i.qty,0);
  const cnt = cart.reduce((s,i)=>s+i.qty,0);
  const shipping = sub>=3000?0:200;
  const total = sub+shipping;
  const upd=(id,d)=>setCart(c=>c.map(i=>i.id===id?{...i,qty:Math.max(1,i.qty+d)}:i));
  const rem=(id)=>{ setCart(c=>c.filter(i=>i.id!==id)); toast("Item removed"); };
  if (!cart.length) return (
    <div className="empty" style={{ paddingTop:"5rem" }}>
      <div className="empty-icon">🛒</div><h3>Your bag is empty</h3>
      <p style={{ marginBottom:"1.5rem" }}>Discover our handwoven collections</p>
      <button className="btn-primary" onClick={onGoProducts}>Shop Now</button>
    </div>
  );
  return (
    <div>
      <div className="page-banner"><h1>Shopping Bag</h1></div>
      <div className="cart-layout">
        <div>
          <h3 style={{ fontFamily:"'Cormorant Garamond',serif", fontSize:"1.3rem", color:"var(--crimson)", marginBottom:"1rem" }}>Your Bag ({cnt} item{cnt!==1?"s":""})</h3>
          {cart.map(item=>(
            <div key={item.id} className="cart-item">
              <div className="cart-img">
                {item.image?<img src={item.image} alt={item.name}/>:<span style={{ fontSize:"2rem" }}>{item.emoji||"🥻"}</span>}
              </div>
              <div>
                <div className="cart-name">{item.name}</div>
                <div className="cart-meta">{item.fabric}</div>
                <div className="qty-ctrl" style={{ marginTop:8 }}>
                  <button className="qty-btn" style={{ width:28,height:28 }} onClick={()=>upd(item.id,-1)}>−</button>
                  <div className="qty-display" style={{ width:36,height:28,fontSize:"0.9rem" }}>{item.qty}</div>
                  <button className="qty-btn" style={{ width:28,height:28 }} onClick={()=>upd(item.id,1)}>+</button>
                </div>
              </div>
              <div>
                <div className="cart-price">{fmt(item.price*item.qty)}</div>
                <div style={{ fontSize:"0.72rem",color:"var(--muted)",textAlign:"right" }}>{fmt(item.price)} each</div>
                <button className="remove-btn" onClick={()=>rem(item.id)}>✕ Remove</button>
              </div>
            </div>
          ))}
        </div>
        <div className="summary-box">
          <div className="summary-title">Order Summary</div>
          <div className="summary-row"><span>Subtotal ({cnt} items)</span><span>{fmt(sub)}</span></div>
          <div className="summary-row"><span>Shipping</span><span style={shipping===0?{color:"var(--green)",fontWeight:700}:{}}>{shipping===0?"FREE":fmt(shipping)}</span></div>
          {shipping>0&&<p style={{ fontSize:"0.75rem",color:"var(--muted)",marginBottom:"0.5rem" }}>Add {fmt(3000-sub)} more for FREE shipping</p>}
          <div className="summary-total"><span>Total</span><span style={{ color:"var(--crimson)" }}>{fmt(total)}</span></div>
          <button className="btn-primary btn-full" style={{ marginTop:"1.2rem",padding:"0.9rem" }} onClick={onGoCheckout}>Proceed to Checkout →</button>
          <button style={{ width:"100%",background:"none",border:"1px solid var(--border)",padding:"0.6rem",cursor:"pointer",marginTop:"0.6rem",color:"var(--textMid)",fontFamily:"'Crimson Pro',serif",fontSize:"0.88rem" }} onClick={onGoProducts}>Continue Shopping</button>
          <div style={{ marginTop:"1rem",paddingTop:"0.8rem",borderTop:"1px solid var(--border)",fontSize:"0.75rem",color:"var(--muted)" }}>🔒 Secure Checkout</div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   SHOP — CHECKOUT
═══════════════════════════════════════════ */
function ShopCheckout({ cart, products, orders, settings, saveOrders, saveProducts, setCart, onConfirm, toast }) {
  const [form, setForm] = useState({ name:"", phone:"", address:"", city:"Varanasi", state:"Uttar Pradesh", pin:"", payMethod:"QR" });
  const sub = cart.reduce((s,i)=>s+i.price*i.qty,0);
  const shipping = sub>=3000?0:200;
  const total = sub+shipping;
  const hc = f=>e=>setForm(x=>({...x,[f]:e.target.value}));
  const place = () => {
    if (!form.name||!form.phone||!form.address||!form.pin) { toast("Please fill all required fields"); return; }
    const id = "DSP-"+Date.now();
    const newOrder = { id, customer:form.name, phone:form.phone, address:`${form.address}, ${form.city}, ${form.state} - ${form.pin}`,
      items:cart.map(i=>({productId:i.id,name:i.name,qty:i.qty,price:i.price})), total, status:"pending", paymentMethod:form.payMethod, createdAt:Date.now() };
    saveOrders([newOrder,...orders]);
    saveProducts(products.map(p=>{ const ci=cart.find(i=>i.id===p.id); return ci?{...p,stock:Math.max(0,p.stock-ci.qty)}:p; }));
    setCart([]);
    onConfirm(newOrder);
    toast(`🎉 Order ${id} placed!`);
  };
  return (
    <div>
      <div className="page-banner"><h1>Checkout</h1></div>
      <div className="checkout-layout">
        <div>
          <div className="card" style={{ marginBottom:"1rem" }}>
            <h3 style={{ fontFamily:"'Cormorant Garamond',serif",fontSize:"1.15rem",color:"var(--crimson)",marginBottom:"1rem",paddingBottom:"0.5rem",borderBottom:"1px solid var(--border)" }}>📍 Delivery Address</h3>
            <div className="form-row">
              <div className="form-group"><label className="form-label">Full Name *</label><input className="form-input" placeholder="Your Name" value={form.name} onChange={hc("name")}/></div>
              <div className="form-group"><label className="form-label">Phone *</label><input className="form-input" placeholder="+91 98765 43210" value={form.phone} onChange={hc("phone")}/></div>
            </div>
            <div className="form-group"><label className="form-label">Address *</label><input className="form-input" placeholder="House/Flat No, Street, Area" value={form.address} onChange={hc("address")}/></div>
            <div className="form-row-3">
              <div className="form-group"><label className="form-label">City</label><input className="form-input" value={form.city} onChange={hc("city")}/></div>
              <div className="form-group"><label className="form-label">State</label><input className="form-input" value={form.state} onChange={hc("state")}/></div>
              <div className="form-group"><label className="form-label">PIN Code *</label><input className="form-input" placeholder="221001" value={form.pin} onChange={hc("pin")}/></div>
            </div>
          </div>
          <div className="card">
            <h3 style={{ fontFamily:"'Cormorant Garamond',serif",fontSize:"1.15rem",color:"var(--crimson)",marginBottom:"1rem",paddingBottom:"0.5rem",borderBottom:"1px solid var(--border)" }}>💳 Payment</h3>
            {[["QR","📱 Scan QR / UPI","Google Pay, PhonePe, Paytm"],["COD","💵 Cash on Delivery","Payment online after receiving"]].map(([val,lbl,sub2])=>(
              <div key={val} className={`payment-opt${form.payMethod===val?" active":""}`} onClick={()=>setForm(f=>({...f,payMethod:val}))}>
                <input type="radio" readOnly checked={form.payMethod===val} style={{ accentColor:"var(--crimson)" }}/>
                <div><div style={{ fontWeight:600,fontSize:"0.95rem" }}>{lbl}</div><div style={{ fontSize:"0.75rem",color:"var(--muted)" }}>{sub2}</div></div>
              </div>
            ))}
            {form.payMethod==="COD" && (
              <div style={{ background:"#FFF8E1",border:"1px solid #FFD54F",borderLeft:"4px solid #F9A825",padding:"0.75rem 1rem",marginTop:"0.3rem",display:"flex",gap:"0.6rem",alignItems:"flex-start" }}>
                <span style={{ fontSize:"1.1rem",flexShrink:0 }}>ℹ️</span>
                <p style={{ fontSize:"0.8rem",color:"#5D4037",lineHeight:1.7,margin:0 }}><strong>Important:</strong> Payment will be made <strong>online only</strong> after receiving the order — via UPI, Google Pay, PhonePe, or Paytm.</p>
              </div>
            )}
            {form.payMethod==="QR" && (
              <div style={{ textAlign:"center",padding:"1rem",background:"var(--ivoryD)",border:"1px solid var(--border)",marginTop:"0.5rem" }}>
                {settings.qr
                  ? <><p style={{ fontSize:"0.82rem",color:"var(--textMid)",marginBottom:"0.8rem" }}>Scan to pay {fmt(total)}</p><img src={settings.qr} alt="QR" style={{ width:150,height:150,objectFit:"contain",margin:"0 auto" }}/>{settings.upiId&&<p style={{ fontSize:"0.75rem",color:"var(--muted)",marginTop:"0.5rem" }}>UPI ID: {settings.upiId}</p>}</>
                  : <p style={{ fontSize:"0.85rem",color:"var(--muted)" }}>QR code not set up yet. Please contact us.</p>}
              </div>
            )}
          </div>
        </div>
        <div className="summary-box">
          <div className="summary-title">Your Order</div>
          {cart.map(i=>(
            <div key={i.id} style={{ display:"flex",justifyContent:"space-between",fontSize:"0.82rem",padding:"0.35rem 0",borderBottom:"1px solid var(--border)",color:"var(--textMid)" }}>
              <span>{i.name} ×{i.qty}</span><span style={{ fontWeight:700,color:"var(--crimson)" }}>{fmt(i.price*i.qty)}</span>
            </div>
          ))}
          <div style={{ marginTop:"0.8rem" }}>
            {[["Subtotal",sub],["Shipping",shipping]].map(([k,v])=>(
              <div key={k} className="summary-row"><span>{k}</span><span>{v===0&&k==="Shipping"?<span style={{ color:"var(--green)",fontWeight:700 }}>FREE</span>:fmt(v)}</span></div>
            ))}
            <div className="summary-total"><span>Total</span><span style={{ color:"var(--crimson)" }}>{fmt(total)}</span></div>
          </div>
          <button className="btn-primary btn-full" style={{ marginTop:"1rem",padding:"0.9rem" }} onClick={place}>✦ Place Order</button>
          <p style={{ textAlign:"center",fontSize:"0.7rem",color:"var(--muted)",marginTop:"0.5rem" }}>🔒 Secure Checkout</p>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   SHOP — CONFIRM
═══════════════════════════════════════════ */
function ShopConfirm({ order, shopName, settings, onGoHome, onGoMyOrders }) {
  const waNum = (settings?.whatsapp||"").replace(/\D/g,"");
  const waMsg = order ? `Hi ${shopName}! 🙏\n\nI just placed an order.\n\n*Order ID:* ${order.id}\n*Name:* ${order.customer}\n*Phone:* ${order.phone}\n*Address:* ${order.address}\n\n*Items:*\n${order.items.map(i=>`• ${i.name} ×${i.qty} = ${fmt(i.price*i.qty)}`).join("\n")}\n\n*Total:* ${fmt(order.total)}\n*Payment:* ${order.paymentMethod}\n\nPlease confirm my order. Thank you! ✨` : "";
  return (
    <div className="confirm-wrap">
      <div className="confirm-card">
        <div style={{ fontSize:"3.5rem",marginBottom:"1rem" }}>🎉</div>
        <h2 style={{ fontFamily:"'Cormorant Garamond',serif",fontSize:"2rem",color:"var(--green)",marginBottom:"0.5rem" }}>Order Placed!</h2>
        {order && <p style={{ fontFamily:"'Cormorant Garamond',serif",color:"var(--crimson)",fontWeight:700,marginBottom:"0.5rem",fontSize:"1.1rem" }}>Order ID: {order.id}</p>}
        <p style={{ color:"var(--textMid)",lineHeight:1.7,marginBottom:"1.5rem" }}>Thank you for shopping with <strong>{shopName}</strong>. Your order is confirmed!</p>
        {waNum && order && (
          <a href={`https://wa.me/91${waNum}?text=${encodeURIComponent(waMsg)}`} target="_blank" rel="noreferrer"
            style={{ display:"flex",alignItems:"center",justifyContent:"center",gap:"0.6rem",background:"#25D366",color:"#fff",padding:"0.9rem 1.5rem",textDecoration:"none",fontFamily:"'Cormorant Garamond',serif",fontSize:"1rem",fontWeight:700,letterSpacing:1,marginBottom:"0.8rem" }}>
            💬 Send Order on WhatsApp
          </a>
        )}
        <div style={{ display:"flex",gap:"0.8rem",justifyContent:"center",flexWrap:"wrap" }}>
          <button className="btn-primary" onClick={onGoHome}>Continue Shopping</button>
          <button className="btn-outline" onClick={onGoMyOrders}>View My Orders</button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   SHOP — MY ORDERS
═══════════════════════════════════════════ */
function ShopMyOrders({ orders, onGoProducts }) {
  const [phone, setPhone]       = useState("");
  const [submitted, setSubm]    = useState(false);
  const [myOrders, setMyOrders] = useState([]);
  const [err, setErr]           = useState("");
  const cls   = { pending:"#E65100", processing:"#1565C0", shipped:"#2E7D32", delivered:"#6A1B9A", cancelled:"#C62828" };
  const bg    = { pending:"#FFF3E0", processing:"#E3F2FD", shipped:"#E8F5E9", delivered:"#F3E5F5", cancelled:"#FFEBEE" };
  const icons = { pending:"⏳", processing:"⚙️", shipped:"🚚", delivered:"✅", cancelled:"❌" };
  const lookup = () => {
    const cleaned = phone.replace(/\D/g,"").trim();
    if (cleaned.length<10) { setErr("Please enter a valid 10-digit phone number."); return; }
    setMyOrders(orders.filter(o=>o.phone.replace(/\D/g,"").endsWith(cleaned.slice(-10))));
    setSubm(true); setErr("");
  };
  return (
    <div>
      <div className="page-banner"><h1>My Orders</h1><p>Track your purchases</p></div>
      <div style={{ maxWidth:680,margin:"2.5rem auto",padding:"0 1.5rem" }}>
        {!submitted ? (
          <div className="card" style={{ textAlign:"center" }}>
            <div style={{ fontSize:"2.5rem",marginBottom:"0.8rem" }}>📱</div>
            <h2 style={{ fontFamily:"'Cormorant Garamond',serif",fontSize:"1.6rem",color:"var(--crimson)",marginBottom:"0.4rem" }}>Find Your Orders</h2>
            <p style={{ fontSize:"0.88rem",color:"var(--muted)",marginBottom:"1.5rem",lineHeight:1.6 }}>Enter the phone number you used while placing your order.</p>
            <div style={{ maxWidth:300,margin:"0 auto" }}>
              <label className="form-label" style={{ textAlign:"left",display:"block" }}>Your Phone Number</label>
              <input className="form-input" placeholder="e.g. 9876543210" value={phone} onChange={e=>setPhone(e.target.value)}
                onKeyDown={e=>e.key==="Enter"&&lookup()} style={{ marginBottom:"0.5rem",textAlign:"center",letterSpacing:1,fontSize:"1rem" }} maxLength={13} autoFocus/>
              {err&&<div style={{ color:"#C62828",fontSize:"0.8rem",marginBottom:"0.5rem" }}>{err}</div>}
              <button className="btn-primary btn-full" style={{ padding:"0.8rem" }} onClick={lookup}>🔍 Find My Orders</button>
            </div>
          </div>
        ) : (
          <div>
            <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"1.2rem",flexWrap:"wrap",gap:"0.5rem" }}>
              <div>
                <div style={{ fontFamily:"'Cormorant Garamond',serif",fontSize:"1.3rem",color:"var(--crimson)",fontWeight:700 }}>
                  {myOrders.length>0?`${myOrders.length} order${myOrders.length!==1?"s":""} found`:"No orders found"}
                </div>
                <div style={{ fontSize:"0.78rem",color:"var(--muted)" }}>for +91 {phone.replace(/\D/g,"").slice(-10)}</div>
              </div>
              <button className="btn-outline" style={{ fontSize:"0.82rem",padding:"0.4rem 0.9rem" }} onClick={()=>{ setSubm(false); setMyOrders([]); setPhone(""); }}>← Search Again</button>
            </div>
            {myOrders.length===0
              ? <div className="card" style={{ textAlign:"center",padding:"2.5rem" }}>
                  <div style={{ fontSize:"2.5rem",marginBottom:"0.8rem" }}>📦</div>
                  <h3 style={{ fontFamily:"'Cormorant Garamond',serif",fontSize:"1.4rem",color:"var(--crimson)",marginBottom:"0.5rem" }}>No Orders Found</h3>
                  <p style={{ fontSize:"0.88rem",color:"var(--muted)",marginBottom:"1.2rem" }}>Check the number and try again.</p>
                  <button className="btn-primary" onClick={onGoProducts}>Start Shopping</button>
                </div>
              : myOrders.map(o=>{
                  const stepKeys=["pending","processing","shipped","delivered"];
                  const curIdx=stepKeys.indexOf(o.status);
                  const date=new Date(o.createdAt).toLocaleDateString("en-IN",{day:"numeric",month:"long",year:"numeric"});
                  return (
                    <div key={o.id} style={{ background:"#fff",border:"1px solid var(--border)",marginBottom:"1.2rem",overflow:"hidden" }}>
                      <div style={{ background:"var(--deep)",padding:"0.8rem 1.2rem",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:"0.5rem" }}>
                        <div style={{ display:"flex",gap:"1.5rem",flexWrap:"wrap",alignItems:"center" }}>
                          {[["Order ID",o.id,true],["Date",date,false],["Total",fmt(o.total),true],["Payment",o.paymentMethod,false]].map(([lbl,val,gold])=>(
                            <div key={lbl}>
                              <div style={{ fontSize:"0.62rem",letterSpacing:2,color:"var(--goldL)",textTransform:"uppercase" }}>{lbl}</div>
                              <div style={{ fontFamily:gold?"'Cormorant Garamond',serif":"inherit",fontWeight:gold?700:400,color:gold?"var(--gold)":"rgba(253,248,239,.85)",fontSize:gold?"1rem":"0.85rem" }}>{val}</div>
                            </div>
                          ))}
                        </div>
                        <div style={{ background:bg[o.status]||"#eee",color:cls[o.status]||"#555",padding:"0.35rem 0.9rem",fontWeight:700,fontSize:"0.82rem",display:"flex",alignItems:"center",gap:"0.4rem" }}>
                          {icons[o.status]||"📦"} <span style={{ textTransform:"capitalize" }}>{o.status}</span>
                        </div>
                      </div>
                      {/* Progress */}
                      <div style={{ padding:"0.9rem 1.2rem",background:"var(--ivoryD)",borderBottom:"1px solid var(--border)" }}>
                        {o.status==="cancelled"
                          ? <div style={{ fontSize:"0.82rem",color:"#C62828",fontWeight:600 }}>❌ This order was cancelled.</div>
                          : <div style={{ display:"flex",alignItems:"center" }}>
                              {["Ordered","Processing","Shipped","Delivered"].map((step,idx)=>{
                                const done=idx<=curIdx; const active=idx===curIdx;
                                return (
                                  <div key={step} style={{ display:"flex",alignItems:"center",flex:idx<3?1:"none" }}>
                                    <div style={{ display:"flex",flexDirection:"column",alignItems:"center",gap:4 }}>
                                      <div style={{ width:26,height:26,borderRadius:"50%",background:done?"var(--crimson)":"var(--border)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"0.72rem",color:done?"#fff":"var(--muted)",fontWeight:700,boxShadow:active?"0 0 0 3px rgba(139,0,0,.18)":"none",flexShrink:0 }}>
                                        {done&&idx<curIdx?"✓":idx+1}
                                      </div>
                                      <div style={{ fontSize:"0.62rem",color:done?"var(--crimson)":"var(--muted)",fontWeight:done?700:400,whiteSpace:"nowrap" }}>{step}</div>
                                    </div>
                                    {idx<3&&<div style={{ flex:1,height:2,background:idx<curIdx?"var(--crimson)":"var(--border)",margin:"0 4px",marginBottom:16 }}/>}
                                  </div>
                                );
                              })}
                            </div>}
                      </div>
                      {/* Items */}
                      <div style={{ padding:"1rem 1.2rem" }}>
                        <div style={{ fontSize:"0.68rem",letterSpacing:2,textTransform:"uppercase",color:"var(--muted)",marginBottom:"0.6rem" }}>Items Ordered</div>
                        {o.items.map((item,idx)=>(
                          <div key={idx} style={{ display:"flex",justifyContent:"space-between",alignItems:"center",padding:"0.45rem 0",borderBottom:"1px solid var(--border)",fontSize:"0.9rem" }}>
                            <div>
                              <div style={{ fontWeight:600,color:"var(--textDark)" }}>{item.name}</div>
                              <div style={{ fontSize:"0.74rem",color:"var(--muted)" }}>Qty: {item.qty}</div>
                            </div>
                            <div style={{ fontFamily:"'Cormorant Garamond',serif",fontWeight:700,color:"var(--crimson)" }}>{fmt(item.price*item.qty)}</div>
                          </div>
                        ))}
                      </div>
                      {o.address && (
                        <div style={{ padding:"0.8rem 1.2rem",borderTop:"1px solid var(--border)",background:"var(--ivoryD)",display:"flex",gap:"0.7rem" }}>
                          <span style={{ flexShrink:0,marginTop:1 }}>📍</span>
                          <div>
                            <div style={{ fontSize:"0.68rem",letterSpacing:1.5,textTransform:"uppercase",color:"var(--muted)",marginBottom:3 }}>Delivery Address</div>
                            <div style={{ fontSize:"0.88rem",color:"var(--textMid)",lineHeight:1.6 }}><strong style={{ color:"var(--textDark)" }}>{o.customer}</strong> · {o.phone}<br/>{o.address}</div>
                          </div>
                        </div>
                      )}
                      <div style={{ padding:"0.65rem 1.2rem",borderTop:"1px solid var(--border)",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:"0.5rem" }}>
                        <div style={{ fontSize:"0.76rem",color:"var(--muted)" }}>Need help? Contact us on WhatsApp with Order ID <strong>{o.id}</strong></div>
                        <div style={{ fontFamily:"'Cormorant Garamond',serif",fontWeight:700,color:"var(--crimson)" }}>Total: {fmt(o.total)}</div>
                      </div>
                    </div>
                  );
                })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   ADMIN — DASHBOARD
═══════════════════════════════════════════ */
function AdminDashboard({ products, orders, onGoInventory }) {
  const revenue  = orders.reduce((s,o)=>s+o.total,0);
  const lowStock = products.filter(p=>p.stock>0&&p.stock<5).length;
  const oos      = products.filter(p=>p.stock===0).length;
  const pending  = orders.filter(o=>o.status==="pending").length;
  return (
    <div>
      <h2 style={{ fontFamily:"'Cormorant Garamond',serif",fontSize:"1.8rem",color:"var(--crimson)",marginBottom:"1.5rem" }}>Dashboard</h2>
      <div className="stat-grid">
        {[{l:"Total Orders",v:orders.length,c:"var(--gold)"},{l:"Revenue",v:fmt(revenue),c:"var(--crimson)"},{l:"Active Products",v:products.filter(p=>p.active).length,c:"var(--green)"},{l:"Pending Orders",v:pending,c:"#E65100"}].map(({l,v,c})=>(
          <div key={l} className="stat-card" style={{ borderLeftColor:c }}>
            <div className="stat-label">{l}</div>
            <div className="stat-val">{v}</div>
          </div>
        ))}
      </div>
      {(lowStock>0||oos>0)&&(
        <div className="stock-alert">
          <span><strong style={{ color:"#E65100" }}>⚠ Stock Alert:</strong>{" "}{oos>0&&`${oos} OUT OF STOCK. `}{lowStock>0&&`${lowStock} LOW STOCK.`}</span>
          <button className="btn-sm" style={{ background:"#E65100" }} onClick={onGoInventory}>Manage →</button>
        </div>
      )}
      <h3 style={{ fontFamily:"'Cormorant Garamond',serif",fontSize:"1.2rem",color:"var(--crimson)",marginBottom:"1rem" }}>Recent Orders</h3>
      <OrdersTable orders={orders.slice(0,5)}/>
    </div>
  );
}

/* ═══════════════════════════════════════════
   ADMIN — PRODUCTS
═══════════════════════════════════════════ */
const EMPTY_FORM = { name:"", category:"Saree", fabric:"", price:"", originalPrice:"", stock:"", sku:"", desc:"", image:null, extraImages:[], emoji:"🥻", active:true, onSale:false, colors:"", sizes:"" };

function AdminProducts({ products, saveProducts, toast }) {
  const [showForm, setShowForm] = useState(false);
  const [editId,   setEditId]   = useState(null);
  const [form,     setForm]     = useState(EMPTY_FORM);
  const emojis = ["🥻","👘","👗","🧣","👔","💎","✨"];
  const set = f=>e=>setForm(x=>({...x,[f]:e.target.value}));
  const openNew  = ()=>{ setForm(EMPTY_FORM); setEditId(null); setShowForm(true); window.scrollTo(0,200); };
  const openEdit = p=>{ setForm({...p,price:String(p.price),originalPrice:p.originalPrice?String(p.originalPrice):"",stock:String(p.stock)}); setEditId(p.id); setShowForm(true); window.scrollTo(0,200); };
  const save = ()=>{
    if(!form.name||!form.price||form.stock===""){toast("Name, price & stock required");return;}
    const prod={...form,price:Number(form.price),originalPrice:form.originalPrice?Number(form.originalPrice):null,stock:Number(form.stock),id:editId||"p"+Date.now(),createdAt:editId?form.createdAt:Date.now()};
    saveProducts(editId?products.map(p=>p.id===editId?prod:p):[prod,...products]);
    setShowForm(false); toast(editId?"Product updated!":"Product added!");
  };
  const toggleActive = id=>{ saveProducts(products.map(p=>p.id===id?{...p,active:!p.active}:p)); toast("Status updated"); };
  const updateStock  = (id,val)=>{ const n=Number(val); if(!isNaN(n)&&n>=0) saveProducts(products.map(p=>p.id===id?{...p,stock:n}:p)); };
  const delProduct   = id=>{ if(window.confirm("Delete this product? Cannot be undone.")) { saveProducts(products.filter(p=>p.id!==id)); toast("Product deleted"); } };

  return (
    <div>
      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"1.5rem",flexWrap:"wrap",gap:"0.5rem" }}>
        <h2 style={{ fontFamily:"'Cormorant Garamond',serif",fontSize:"1.8rem",color:"var(--crimson)",margin:0 }}>Products & Inventory</h2>
        <button className="btn-gold" onClick={openNew}>+ Add New Product</button>
      </div>
      {showForm&&(
        <div className="card card-gold" style={{ marginBottom:"2rem" }}>
          <h3 style={{ fontFamily:"'Cormorant Garamond',serif",fontSize:"1.15rem",color:"var(--crimson)",marginBottom:"1.2rem" }}>{editId?"Edit Product":"Add New Product"}</h3>
          <div style={{ display:"grid",gridTemplateColumns:"auto 1fr",gap:"1.5rem" }}>
            <div>
              <label className="form-label">Main Photo</label>
              <ImageUploader current={form.image} onUpload={img=>setForm(f=>({...f,image:img}))} width={110} height={120}/>
              <div style={{ display:"flex",gap:4,marginTop:8,flexWrap:"wrap" }}>
                {emojis.map(e=>(
                  <span key={e} onClick={()=>setForm(f=>({...f,emoji:e}))} style={{ cursor:"pointer",fontSize:"1.2rem",padding:"0.2rem",background:form.emoji===e?"var(--ivoryD)":"transparent",border:form.emoji===e?"1px solid var(--gold)":"1px solid transparent" }}>{e}</span>
                ))}
              </div>
            </div>
            <div>
              <div className="form-group"><label className="form-label">Product Name *</label><input className="form-input" placeholder="e.g. Katan Silk Zari Saree" value={form.name} onChange={set("name")}/></div>
              <div className="form-row">
                <div className="form-group"><label className="form-label">Category</label><select className="form-input" value={form.category} onChange={set("category")}>{["Saree","Lehenga","Suit","Dupatta","Kurta","Other"].map(c=><option key={c}>{c}</option>)}</select></div>
                <div className="form-group"><label className="form-label">Fabric</label><input className="form-input" placeholder="e.g. Pure Katan Silk" value={form.fabric} onChange={set("fabric")}/></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label className="form-label">Selling Price (₹) *</label><input className="form-input" type="number" placeholder="18500" value={form.price} onChange={set("price")}/></div>
                <div className="form-group"><label className="form-label">MRP / Original (₹)</label><input className="form-input" type="number" placeholder="24000" value={form.originalPrice} onChange={set("originalPrice")}/></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label className="form-label">Stock Qty *</label><input className="form-input" type="number" placeholder="15" value={form.stock} onChange={set("stock")}/></div>
                <div className="form-group"><label className="form-label">SKU Code</label><input className="form-input" placeholder="BSS-001" value={form.sku||""} onChange={set("sku")}/></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label className="form-label">Colors (comma separated)</label><input className="form-input" placeholder="Deep Red, Royal Blue, Green" value={form.colors||""} onChange={set("colors")}/></div>
                <div className="form-group"><label className="form-label">Sizes (comma separated)</label><input className="form-input" placeholder="S, M, L, XL or Free Size" value={form.sizes||""} onChange={set("sizes")}/></div>
              </div>
              <div className="form-group"><label className="form-label">Description</label><textarea className="form-input" style={{ height:70,resize:"vertical" }} placeholder="Describe this product..." value={form.desc||""} onChange={set("desc")}/></div>
              <div style={{ display:"flex",gap:"1.5rem",flexWrap:"wrap" }}>
                <label style={{ display:"flex",alignItems:"center",gap:"0.5rem",cursor:"pointer",fontSize:"0.88rem",color:"var(--textMid)" }}>
                  <input type="checkbox" checked={!!form.active} onChange={e=>setForm(f=>({...f,active:e.target.checked}))}/> Show in store
                </label>
                <label style={{ display:"flex",alignItems:"center",gap:"0.5rem",cursor:"pointer",fontSize:"0.88rem",color:"#E65100",fontWeight:600 }}>
                  <input type="checkbox" checked={!!form.onSale} onChange={e=>setForm(f=>({...f,onSale:e.target.checked}))}/> 🔥 Mark as SALE
                </label>
              </div>
            </div>
          </div>
          <div style={{ display:"flex",gap:"0.8rem",marginTop:"1.2rem",justifyContent:"flex-end",flexWrap:"wrap" }}>
            <button className="btn-outline" onClick={()=>setShowForm(false)}>Cancel</button>
            <button className="btn-gold" onClick={save}>{editId?"Save Changes":"Add Product"}</button>
          </div>
        </div>
      )}
      <div style={{ overflowX:"auto" }}>
        <table className="data-table">
          <thead><tr>{["Photo","Product","Category","Price","Stock","Status","Actions"].map(h=><th key={h}>{h}</th>)}</tr></thead>
          <tbody>
            {products.map(p=>(
              <tr key={p.id}>
                <td><div style={{ width:46,height:52,background:"var(--ivoryD)",overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center" }}>
                  {p.image?<img src={p.image} alt="" style={{ width:"100%",height:"100%",objectFit:"cover" }}/>:<span style={{ fontSize:"1.5rem" }}>{p.emoji||"🥻"}</span>}
                </div></td>
                <td><div style={{ fontWeight:700,color:"var(--textDark)" }}>{p.name}{p.onSale&&<span style={{ marginLeft:6,fontSize:"0.68rem",background:"#E65100",color:"#fff",padding:"0.1rem 0.4rem" }}>SALE</span>}</div><div style={{ fontSize:"0.7rem",color:"var(--muted)" }}>{p.sku||"—"} · {p.fabric}</div></td>
                <td>{p.category}</td>
                <td><div style={{ fontWeight:700,color:"var(--crimson)" }}>{fmt(p.price)}</div>{p.originalPrice&&<div style={{ fontSize:"0.7rem",color:"var(--muted)",textDecoration:"line-through" }}>{fmt(p.originalPrice)}</div>}</td>
                <td><div style={{ display:"flex",alignItems:"center",gap:5 }}>
                  <input type="number" min="0" defaultValue={p.stock} style={{ width:55,border:"1px solid var(--border)",padding:"0.22rem 0.35rem",background:"var(--ivory)",fontSize:"0.85rem",textAlign:"center" }} onBlur={e=>updateStock(p.id,e.target.value)}/>
                  <span className={`badge badge-${p.stock===0?"out":p.stock<5?"low":"ok"}`}>{p.stock===0?"OUT":p.stock<5?"LOW":"OK"}</span>
                </div></td>
                <td><span className={`badge badge-${p.active?"live":"hidden"}`}>{p.active?"Live":"Hidden"}</span></td>
                <td style={{ whiteSpace:"nowrap" }}>
                  <button className="btn-sm-gold" style={{ marginRight:4 }} onClick={()=>openEdit(p)}>Edit</button>
                  <button className="btn-sm-dark" style={{ marginRight:4 }} onClick={()=>toggleActive(p.id)}>{p.active?"Hide":"Show"}</button>
                  <button style={{ background:"#C62828",color:"#fff",border:"none",padding:"0.28rem 0.65rem",fontSize:"0.75rem",cursor:"pointer" }} onClick={()=>delProduct(p.id)}>🗑</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   ADMIN — ORDERS
═══════════════════════════════════════════ */
function AdminOrders({ orders, saveOrders, toast }) {
  const [search, setSearch]     = useState("");
  const [filter, setFilter]     = useState("");
  const [confirmDel, setConDel] = useState(null);
  const updateStatus = (id,status)=>{ saveOrders(orders.map(o=>o.id===id?{...o,status}:o)); toast("Status updated"); };
  const deleteOrder  = id=>{ saveOrders(orders.filter(o=>o.id!==id)); setConDel(null); toast("Order deleted"); };
  const filtered = orders.filter(o=>
    (!search||o.id.toLowerCase().includes(search.toLowerCase())||o.customer.toLowerCase().includes(search.toLowerCase()))&&
    (!filter||o.status===filter)
  );
  return (
    <div>
      <h2 style={{ fontFamily:"'Cormorant Garamond',serif",fontSize:"1.8rem",color:"var(--crimson)",marginBottom:"1.5rem" }}>Order Management</h2>
      <div style={{ display:"flex",gap:"0.8rem",marginBottom:"1.2rem",flexWrap:"wrap",alignItems:"center" }}>
        <input className="form-input" style={{ width:250 }} placeholder="Search order ID or customer..." value={search} onChange={e=>setSearch(e.target.value)}/>
        <select className="form-input" style={{ width:160 }} value={filter} onChange={e=>setFilter(e.target.value)}>
          <option value="">All Status</option>
          {["pending","processing","shipped","delivered","cancelled"].map(s=><option key={s} value={s}>{s.charAt(0).toUpperCase()+s.slice(1)}</option>)}
        </select>
        <span style={{ fontSize:"0.85rem",color:"var(--muted)" }}>{filtered.length} order(s)</span>
      </div>
      {confirmDel&&(
        <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:500,display:"flex",alignItems:"center",justifyContent:"center",padding:"1rem" }}>
          <div style={{ background:"#fff",border:"2px solid #C62828",padding:"2rem",maxWidth:380,width:"100%",textAlign:"center" }}>
            <div style={{ fontSize:"2.5rem",marginBottom:"0.8rem" }}>🗑️</div>
            <h3 style={{ fontFamily:"'Cormorant Garamond',serif",fontSize:"1.4rem",color:"#C62828",marginBottom:"0.5rem" }}>Delete Order?</h3>
            <p style={{ fontSize:"0.88rem",color:"var(--textMid)",marginBottom:"1.2rem",lineHeight:1.6 }}>Are you sure you want to delete order <strong>{confirmDel}</strong>? This cannot be undone.</p>
            <div style={{ display:"flex",gap:"0.8rem",justifyContent:"center" }}>
              <button className="btn-outline" onClick={()=>setConDel(null)}>Cancel</button>
              <button style={{ background:"#C62828",color:"#fff",border:"none",padding:"0.65rem 1.4rem",cursor:"pointer",fontFamily:"'Cormorant Garamond',serif",fontSize:"0.9rem" }} onClick={()=>deleteOrder(confirmDel)}>Yes, Delete</button>
            </div>
          </div>
        </div>
      )}
      {filtered.length===0
        ? <div className="empty"><p>No orders found.</p></div>
        : <div style={{ overflowX:"auto" }}>
            <table className="data-table">
              <thead><tr>{["Order ID","Customer & Address","Items","Total","Payment","Status","Update Status","Delete"].map(h=><th key={h}>{h}</th>)}</tr></thead>
              <tbody>
                {filtered.map(o=>(
                  <tr key={o.id}>
                    <td style={{ fontFamily:"'Cormorant Garamond',serif",fontWeight:700,color:"var(--crimson)",whiteSpace:"nowrap" }}>{o.id}</td>
                    <td style={{ minWidth:200 }}>
                      <div style={{ fontWeight:700,color:"var(--textDark)" }}>{o.customer}</div>
                      <div style={{ fontSize:"0.75rem",color:"var(--muted)",marginTop:1 }}>📞 {o.phone}</div>
                      {o.address&&<div style={{ fontSize:"0.75rem",color:"var(--textMid)",marginTop:4,lineHeight:1.5,background:"var(--ivoryD)",padding:"0.3rem 0.5rem",borderLeft:"2px solid var(--gold)",maxWidth:220 }}>📍 {o.address}</div>}
                    </td>
                    <td style={{ minWidth:160 }}>{o.items.map((i,idx)=><div key={idx} style={{ fontSize:"0.8rem" }}>{i.name} ×{i.qty}</div>)}</td>
                    <td style={{ fontWeight:700,color:"var(--crimson)",whiteSpace:"nowrap" }}>{fmt(o.total)}</td>
                    <td style={{ fontSize:"0.82rem" }}>{o.paymentMethod}</td>
                    <td><span className={`badge badge-${o.status}||""`}>{o.status}</span></td>
                    <td>
                      <select defaultValue={o.status} onChange={e=>updateStatus(o.id,e.target.value)}
                        style={{ border:"1px solid var(--border)",background:"var(--ivory)",padding:"0.22rem 0.4rem",fontSize:"0.78rem",cursor:"pointer" }}>
                        {["pending","processing","shipped","delivered","cancelled"].map(s=><option key={s} value={s}>{s.charAt(0).toUpperCase()+s.slice(1)}</option>)}
                      </select>
                    </td>
                    <td><button onClick={()=>setConDel(o.id)} style={{ background:"#FFEBEE",color:"#C62828",border:"1px solid #EF9A9A",padding:"0.28rem 0.6rem",fontSize:"0.78rem",cursor:"pointer",fontWeight:600,whiteSpace:"nowrap" }}>🗑 Delete</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>}
    </div>
  );
}

/* ═══════════════════════════════════════════
   ADMIN — SETTINGS (with Ad Banner section)
═══════════════════════════════════════════ */
function AdminSettings({ settings, saveSettings, products, toast }) {
  const [form, setForm] = useState({ ...SEED_SETTINGS, ...settings });
  const [saving, setSaving] = useState(false);
  const [catUploading, setCatUploading] = useState({}); // { Saree: true, ... }
  useEffect(()=>setForm({...SEED_SETTINGS,...settings}),[settings]);
  const set  = f=>e=>setForm(x=>({...x,[f]:e.target.value}));

  const save = async ()=>{
    // Guard: Firestore documents have a hard 1MB limit. Since all category
    // images, the QR code, and the ad banner image live in this one
    // "settings" document together, check the combined size before saving
    // so we fail with a clear message instead of a silent/confusing error.
    const approxSize = new Blob([JSON.stringify(form)]).size;
    if (approxSize > 900 * 1024) {
      toast(`❌ Too much image data (${Math.round(approxSize/1024)}KB). Remove or replace an image and try again.`);
      return;
    }

    setSaving(true);
    try {
      await saveSettings(form);
      toast("Settings saved ✓");
    } catch (e) {
      console.error("Settings save failed:", e);
      toast("❌ Save failed — please check your connection and try again");
    } finally {
      setSaving(false);
    }
  };

  const handleCatImageUpload = (cat, file) => {
    if (!file) return;
    if (file.size > 5*1024*1024) { alert("Max 5MB"); return; }

    setCatUploading(u=>({...u,[cat]:true}));
    compressImage(file, { maxWidth: 500, maxHeight: 500, quality: 0.7 })
      .then(compressed => {
        setForm(f=>({...f, catImages:{...(f.catImages||{}), [cat]: compressed}}));
      })
      .catch(err => {
        console.error("Category image compression failed:", err);
        alert(`Could not process image for ${cat}. Please try a different photo.`);
      })
      .finally(() => {
        setCatUploading(u=>({...u,[cat]:false}));
      });
  };

  const SH = ({children})=>(
    <h3 style={{ fontFamily:"'Cormorant Garamond',serif",fontSize:"1.1rem",color:"var(--crimson)",marginBottom:"1rem",paddingBottom:"0.5rem",borderBottom:"1px solid var(--border)" }}>{children}</h3>
  );

  const Toggle = ({checked, onChange, label})=>(
    <div className="toggle-wrap">
      <label className="toggle">
        <input type="checkbox" checked={!!checked} onChange={onChange}/>
        <span className="toggle-slider"/>
      </label>
      <span className="toggle-label">{label}</span>
    </div>
  );

  return (
    <div style={{ maxWidth:640 }}>
      <h2 style={{ fontFamily:"'Cormorant Garamond',serif",fontSize:"1.8rem",color:"var(--crimson)",marginBottom:"1.5rem" }}>Store Settings</h2>

      {/* ── AD BANNER ── */}
      <div className="card card-gold" style={{ marginBottom:"1rem", borderColor: form.adEnabled?"var(--crimson)":"var(--gold)" }}>
        <SH>📣 Ad Banner / Popup</SH>
        <p style={{ fontSize:"0.82rem",color:"var(--textMid)",marginBottom:"1.2rem",lineHeight:1.6 }}>
          When enabled, customers see a promotional popup when they open your website. Upload a sale product image, add a title, and link it to any product.
        </p>

        {/* Master toggle */}
        <div style={{ background:form.adEnabled?"#fff8f5":"var(--ivoryD)",border:`2px solid ${form.adEnabled?"var(--crimson)":"var(--border)"}`,padding:"1rem",marginBottom:"1.2rem",borderRadius:4 }}>
          <Toggle
            checked={form.adEnabled}
            onChange={e=>setForm(f=>({...f,adEnabled:e.target.checked}))}
            label={form.adEnabled ? "🟢 Ad Banner is ON — customers see it when they open the site" : "⚫ Ad Banner is OFF — no popup shown to customers"}
          />
          {form.adEnabled && <p style={{ fontSize:"0.75rem",color:"var(--crimson)",marginTop:"0.5rem",fontWeight:600 }}>⚠ Remember to click "Save All Settings" to apply changes.</p>}
        </div>

        {/* Ad image */}
        <div className="form-group">
          <label className="form-label">Sale / Ad Image (product photo or promotional image)</label>
          <div style={{ display:"flex",gap:"1rem",alignItems:"flex-start",flexWrap:"wrap" }}>
            <ImageUploader current={form.adImage} onUpload={img=>setForm(f=>({...f,adImage:img}))} width={140} height={160} maxMB={3}/>
            <div style={{ flex:1,minWidth:180 }}>
              <p style={{ fontSize:"0.78rem",color:"var(--muted)",marginBottom:"0.8rem",lineHeight:1.6 }}>
                Upload your sale product image or a promotional banner. When clicked, it takes the customer to the linked product.
              </p>
              {form.adImage && (
                <button style={{ background:"none",border:"1px solid #C62828",color:"#C62828",padding:"0.25rem 0.6rem",fontSize:"0.72rem",cursor:"pointer" }}
                  onClick={()=>setForm(f=>({...f,adImage:null}))}>✕ Remove Image</button>
              )}
            </div>
          </div>
        </div>

        {/* Ad text */}
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Ad Title</label>
            <input className="form-input" placeholder='e.g. "Grand Sale — Up to 50% Off!"' value={form.adTitle||""} onChange={set("adTitle")}/>
          </div>
          <div className="form-group">
            <label className="form-label">Badge Text</label>
            <input className="form-input" placeholder='e.g. SALE / NEW / HOT' value={form.adBadge||"SALE"} onChange={set("adBadge")}/>
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Ad Subtitle / Offer Description</label>
          <input className="form-input" placeholder='e.g. "Limited time offer on Banarasi Sarees"' value={form.adSubtitle||""} onChange={set("adSubtitle")}/>
        </div>

        {/* Link to product */}
        <div className="form-group">
          <label className="form-label">Link to Product (when customer clicks the ad)</label>
          <select className="form-input" value={form.adProductId||""} onChange={set("adProductId")}>
            <option value="">— Select a product to link —</option>
            {products.filter(p=>p.active).map(p=>(
              <option key={p.id} value={p.id}>{p.name} — {fmt(p.price)}</option>
            ))}
          </select>
          <p style={{ fontSize:"0.72rem",color:"var(--muted)",marginTop:"0.3rem" }}>
            Leave blank to go to Collections page when clicked.
          </p>
        </div>

        {/* Live preview */}
        {form.adEnabled && (
          <div style={{ background:"var(--ivoryD)",border:"1px solid var(--border)",padding:"1rem",marginTop:"0.5rem" }}>
            <p style={{ fontSize:"0.72rem",letterSpacing:2,textTransform:"uppercase",color:"var(--muted)",marginBottom:"0.5rem" }}>Preview</p>
            <div style={{ display:"flex",gap:"0.8rem",alignItems:"center",flexWrap:"wrap" }}>
              <div style={{ width:60,height:70,background:"var(--deep)",overflow:"hidden",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"1.5rem" }}>
                {form.adImage?<img src={form.adImage} alt="" style={{ width:"100%",height:"100%",objectFit:"cover" }}/>:"🏷️"}
              </div>
              <div>
                {form.adBadge&&<div style={{ background:"var(--crimson)",color:"#fff",fontSize:"0.65rem",padding:"0.1rem 0.4rem",display:"inline-block",marginBottom:4,letterSpacing:1 }}>{form.adBadge}</div>}
                <div style={{ fontFamily:"'Cormorant Garamond',serif",fontWeight:700,color:"var(--crimson)",fontSize:"1rem" }}>{form.adTitle||"Add a title above"}</div>
                <div style={{ fontSize:"0.75rem",color:"var(--muted)",fontStyle:"italic" }}>{form.adSubtitle||"Add a subtitle above"}</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Store Info */}
      <div className="card" style={{ marginBottom:"1rem" }}>
        <SH>🏪 Store Info</SH>
        <div className="form-group"><label className="form-label">Shop Name</label><input className="form-input" value={form.shopName} onChange={set("shopName")}/></div>
        <div className="form-group"><label className="form-label">Tagline</label><input className="form-input" value={form.tagline} onChange={set("tagline")}/></div>
      </div>

      {/* Contact */}
      <div className="card" style={{ marginBottom:"1rem" }}>
        <SH>📞 Contact Details</SH>
        <div className="form-row">
          <div className="form-group"><label className="form-label">WhatsApp Number</label><input className="form-input" placeholder="9876543210 (without +91)" value={form.whatsapp||""} onChange={set("whatsapp")}/></div>
          <div className="form-group"><label className="form-label">Phone Number</label><input className="form-input" placeholder="9876543210" value={form.phone||""} onChange={set("phone")}/></div>
        </div>
        <div className="form-group"><label className="form-label">Email Address</label><input className="form-input" type="email" placeholder="desistyle@gmail.com" value={form.email||""} onChange={set("email")}/></div>
        <div className="form-row">
          <div className="form-group"><label className="form-label">Instagram Handle</label><input className="form-input" placeholder="desistylebypriyanshu" value={form.instagram||""} onChange={set("instagram")}/></div>
          <div className="form-group"><label className="form-label">UPI ID</label><input className="form-input" placeholder="yourname@upi" value={form.upiId||""} onChange={set("upiId")}/></div>
        </div>
        <div className="form-group"><label className="form-label">Shop Address</label><textarea className="form-input" style={{ height:60,resize:"vertical" }} placeholder="Full shop address" value={form.address||""} onChange={set("address")}/></div>
      </div>

      {/* QR */}
      <div className="card" style={{ marginBottom:"1rem" }}>
        <SH>📱 Payment QR Code</SH>
        <p style={{ fontSize:"0.85rem",color:"var(--textMid)",marginBottom:"1rem",lineHeight:1.6 }}>Upload your UPI QR code. Customers scan this at checkout.</p>
        <QRUploader current={form.qr} onUpload={qr=>setForm(f=>({...f,qr}))}/>
        {form.qr&&<button className="btn-sm" style={{ background:"#C62828",marginTop:10,display:"block" }} onClick={()=>{ if(window.confirm("Delete QR code?")) setForm(f=>({...f,qr:null})); }}>🗑️ Delete QR Code</button>}
      </div>

      {/* Category Images */}
      <div className="card" style={{ marginBottom:"1rem" }}>
        <SH>🖼️ Category Images</SH>
        <p style={{ fontSize:"0.82rem",color:"var(--textMid)",marginBottom:"1.2rem",lineHeight:1.6 }}>Upload a photo for each category shown on the homepage.</p>
        <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:"1rem" }}>
          {["Saree","Lehenga","Suit","Dupatta","Kurta"].map(cat=>{
            const current=form.catImages?.[cat]||null;
            const isUploading = !!catUploading[cat];
            return (
              <div key={cat} style={{ border:"1px solid var(--border)",padding:"0.8rem",background:"var(--ivoryD)",textAlign:"center" }}>
                <label className="form-label" style={{ marginBottom:"0.5rem" }}>{cat}</label>
                <div style={{ position:"relative",width:100,height:100,margin:"0 auto 0.5rem" }}>
                  <div onClick={()=>!isUploading && document.getElementById(`cat-img-${cat}`).click()}
                    style={{ width:100,height:100,borderRadius:6,overflow:"hidden",border:"2px dashed var(--border)",background:"#fff",display:"flex",alignItems:"center",justifyContent:"center",cursor:isUploading?"default":"pointer",transition:"border-color .2s",position:"relative" }}
                    onMouseEnter={e=>!isUploading && (e.currentTarget.style.borderColor="var(--gold)")}
                    onMouseLeave={e=>e.currentTarget.style.borderColor="var(--border)"}>
                    {isUploading && (
                      <div style={{ position:"absolute", inset:0, background:"rgba(255,255,255,0.85)", display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column", zIndex:2, fontSize:"0.65rem", color:"var(--crimson)", fontWeight:600 }}>
                        <div style={{ fontSize:"1.3rem", marginBottom:2 }}>⏳</div>
                        Processing
                      </div>
                    )}
                    {current?<img src={current} alt={cat} style={{ width:"100%",height:"100%",objectFit:"cover" }}/>:
                      <div style={{ textAlign:"center",color:"var(--muted)",padding:"0.4rem" }}>
                        <div style={{ fontSize:"1.8rem",marginBottom:4 }}>📷</div>
                        <div style={{ fontSize:"0.68rem" }}>Upload Photo</div>
                      </div>}
                  </div>
                  <input id={`cat-img-${cat}`} type="file" accept="image/*" style={{ display:"none" }}
                    onChange={e=>{ const file=e.target.files[0]; handleCatImageUpload(cat, file); e.target.value=""; }}/>
                </div>
                {current&&!isUploading&&<button onClick={()=>setForm(f=>({...f,catImages:{...(f.catImages||{}),[cat]:null}}))} style={{ background:"none",border:"1px solid #C62828",color:"#C62828",padding:"0.2rem 0.6rem",fontSize:"0.72rem",cursor:"pointer" }}>✕ Remove</button>}
              </div>
            );
          })}
        </div>
      </div>

      <button className="btn-gold btn-full" style={{ padding:"0.9rem" }} onClick={save} disabled={saving}>
        {saving ? "💾 Saving..." : "💾 Save All Settings"}
      </button>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   MAIN APP
═══════════════════════════════════════════════════════════ */
export default function App() {
  const [view,           setView]           = useState("shop");
  const [shopPage,       setShopPage]       = useState("home");
  const [adminTab,       setAdminTab]       = useState("dashboard");
  const [products,       setProducts]       = useState([]);
  const [orders,         setOrders]         = useState([]);
  const [settings,       setSettings]       = useState(SEED_SETTINGS);
  const [cart,           setCart]           = useState([]);
  const [selected,       setSelected]       = useState(null);
  const [lastOrder,      setLastOrder]      = useState(null);
  const [filterCat,      setFilterCat]      = useState("");
  const [notif,          setNotif]          = useState({ msg:"", show:false });
  const [loaded,         setLoaded]         = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showAd,         setShowAd]         = useState(false);

  // Admin auth
  const urlParams       = new URLSearchParams(window.location.search);
  const hasSecretInUrl  = urlParams.get("admin") === ADMIN_SECRET_PATH;
  const hasSession      = sessionStorage.getItem("dsp_admin_auth") === "1";
  const showAdminLogin  = hasSecretInUrl && !hasSession;
  const [isAdminSession, setIsAdminSession] = useState(hasSession);

  // Load data from Firebase
  useEffect(()=>{
    const loadAll = async ()=>{
      try {
        const [prods,ords,setts] = await Promise.all([DB.get("products"),DB.get("orders"),DB.get("settings")]);
        setProducts(Array.isArray(prods)?prods:[]);
        setOrders(Array.isArray(ords)?ords:[]);
        const mergedSettings = setts?{...SEED_SETTINGS,...setts}:SEED_SETTINGS;
        setSettings(mergedSettings);
        // Show ad banner if enabled — only once per session
        if (mergedSettings.adEnabled && !sessionStorage.getItem("dsp_ad_shown")) {
          setTimeout(()=>setShowAd(true), 1200); // slight delay so page loads first
        }
      } catch(e) {
        console.error("Load error:",e);
        setProducts([]); setOrders([]); setSettings(SEED_SETTINGS);
      } finally { setLoaded(true); }
    };
    loadAll();
  },[]);

  // Browser back button fix
  useEffect(()=>{
    const handlePop = e=>{
      const page=e.state?.page||"home";
      setShopPage(page); setMobileMenuOpen(false); window.scrollTo(0,0);
    };
    window.addEventListener("popstate",handlePop);
    window.history.replaceState({page:"home"},"",window.location.pathname+window.location.search);
    return ()=>window.removeEventListener("popstate",handlePop);
  },[]);

  const saveProducts = useCallback(async p=>{ setProducts(p); await DB.set("products",p); },[]);
  const saveOrders   = useCallback(async o=>{ setOrders(o);   await DB.set("orders",  o); },[]);
  const saveSettings = useCallback(async s=>{ setSettings(s); await DB.set("settings",s); },[]);

  const toast = useCallback(msg=>{ setNotif({msg,show:true}); setTimeout(()=>setNotif(n=>({...n,show:false})),2800); },[]);

  const go = useCallback(page=>{
    window.history.pushState({page},"",window.location.pathname+window.location.search);
    setShopPage(page); setMobileMenuOpen(false); window.scrollTo(0,0);
  },[]);

  const addToCart = useCallback((product,qty=1)=>{
    setCart(c=>{ const ex=c.find(i=>i.id===product.id); if(ex) return c.map(i=>i.id===product.id?{...i,qty:i.qty+qty}:i); return [...c,{...product,qty}]; });
    toast(`Added: ${product.name}`);
  },[toast]);

  const viewProduct = useCallback(p=>{ setSelected(p); go("detail"); },[go]);

  // Ad banner — view product from ad
  const handleAdViewProduct = useCallback(productId=>{
    const p = products.find(x=>x.id===productId);
    if(p) viewProduct(p);
    setShowAd(false);
    sessionStorage.setItem("dsp_ad_shown","1");
  },[products,viewProduct]);

  const closeAd = useCallback(()=>{
    setShowAd(false);
    sessionStorage.setItem("dsp_ad_shown","1");
  },[]);

  const cartCount   = cart.reduce((s,i)=>s+i.qty,0);
  const activeProds = products.filter(p=>p.active);

  if (!loaded) return (
    <div className="loading-screen">
      <img src="/logo.jpeg" alt="Desi Style" style={{ width:110,height:"auto",borderRadius:8,marginBottom:"1.2rem",opacity:0.92 }}/>
      <div style={{ color:"var(--gold)",fontFamily:"'Cormorant Garamond',serif",fontSize:"1.4rem",fontWeight:700,letterSpacing:3,marginBottom:"0.3rem" }}>Desi Style</div>
      <div style={{ color:"var(--goldL)",fontFamily:"'Cormorant Garamond',serif",fontSize:"0.82rem",letterSpacing:3,fontStyle:"italic",marginBottom:"1.5rem",opacity:0.8 }}>by Priyanshu</div>
      <div className="loading-spinner"/>
      <div style={{ color:"rgba(232,201,122,0.5)",fontSize:"0.72rem",letterSpacing:2,marginTop:"1rem" }}>Fabric that defines you</div>
    </div>
  );

  if (showAdminLogin) return <AdminLogin onSuccess={()=>{ setIsAdminSession(true); setView("admin"); }}/>;

  return (
    <div style={{ minHeight:"100vh",background:"var(--ivory)",fontFamily:"'Crimson Pro',Georgia,serif",color:"var(--textDark)" }}>
      <Notif msg={notif.msg} show={notif.show}/>

      {/* Ad Banner Popup */}
      {showAd && view==="shop" && (
        <AdBanner settings={settings} onClose={closeAd} onViewProduct={handleAdViewProduct}/>
      )}

      <Header view={view} setView={setView} shopPage={shopPage} setShopPage={setShopPage}
        adminTab={adminTab} setAdminTab={setAdminTab} cartCount={cartCount} settings={settings}
        mobileMenuOpen={mobileMenuOpen} setMobileMenuOpen={setMobileMenuOpen} isAdminSession={isAdminSession}/>

      {/* SHOP */}
      {view==="shop"&&shopPage==="home"     &&<ShopHome activeProducts={activeProds} products={products} orders={orders} settings={settings} onGoProducts={(cat)=>{setFilterCat(cat);go("products");}} onViewProduct={viewProduct} onAddCart={addToCart}/>}
      {view==="shop"&&shopPage==="products" &&<ShopProducts activeProducts={activeProds} initialCat={filterCat} onViewProduct={viewProduct} onAddCart={addToCart}/>}
      {view==="shop"&&shopPage==="detail"   &&<ShopDetail product={selected} onAddCart={addToCart} onGoCart={()=>go("cart")}/>}
      {view==="shop"&&shopPage==="cart"     &&<ShopCart cart={cart} setCart={setCart} onGoProducts={()=>go("products")} onGoCheckout={()=>go("checkout")} toast={toast}/>}
      {view==="shop"&&shopPage==="checkout" &&<ShopCheckout cart={cart} products={products} orders={orders} settings={settings} saveOrders={saveOrders} saveProducts={saveProducts} setCart={setCart} onConfirm={o=>{setLastOrder(o);go("confirm");}} toast={toast}/>}
      {view==="shop"&&shopPage==="confirm"  &&<ShopConfirm order={lastOrder} shopName={settings.shopName} settings={settings} onGoHome={()=>go("home")} onGoMyOrders={()=>go("myorders")}/>}
      {view==="shop"&&shopPage==="myorders" &&<ShopMyOrders orders={orders} onGoProducts={()=>go("products")}/>}

      {/* ADMIN */}
      {view==="admin"&&(
        <div className="admin-wrap">
          <div className="admin-tabs">
            {["dashboard","products","orders","settings"].map(t=>(
              <button key={t} className={`admin-tab${adminTab===t?" active":""}`} onClick={()=>setAdminTab(t)}>
                {t.charAt(0).toUpperCase()+t.slice(1)}
              </button>
            ))}
          </div>
          {adminTab==="dashboard"&&<AdminDashboard products={products} orders={orders} onGoInventory={()=>setAdminTab("products")}/>}
          {adminTab==="products" &&<AdminProducts  products={products} saveProducts={saveProducts} toast={toast}/>}
          {adminTab==="orders"   &&<AdminOrders    orders={orders}     saveOrders={saveOrders}     toast={toast}/>}
          {adminTab==="settings" &&<AdminSettings  settings={settings} saveSettings={saveSettings} products={products} toast={toast}/>}
        </div>
      )}
    </div>
  );
}