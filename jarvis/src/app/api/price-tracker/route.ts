import { NextRequest, NextResponse } from "next/server";

const KEEPA_API_URL = "https://api.keepa.com/product";
const KEEPA_TOKEN = process.env.KEEPA_API_KEY;

interface TrackedProduct {
  id: string;
  asin: string;
  title: string;
  imageUrl: string;
  currentPrice: number;
  lowestPrice: number;
  highestPrice: number;
  targetPrice: number;
  currency: string;
  lastUpdated: string;
  url: string;
  priceHistory: { date: string; price: number }[];
}

// In-memory storage (replace with database in production)
let trackedProducts: TrackedProduct[] = [];

// Fetch product data from Keepa
async function fetchProductData(asin: string): Promise<Partial<TrackedProduct> | null> {
  if (!KEEPA_TOKEN) {
    console.log("Keepa API key not configured");
    return null;
  }

  try {
    const response = await fetch(
      `${KEEPA_API_URL}?key=${KEEPA_TOKEN}&domain=1&asin=${asin}&stats=1&rating=1`,
      { method: "GET" }
    );

    if (!response.ok) {
      console.error("Keepa API error:", response.status);
      return null;
    }

    const data = await response.json();

    if (!data.products || data.products.length === 0) {
      return null;
    }

    const product = data.products[0];

    // Extract current price from csv data
    const csvData = product.csv?.[1] || []; // [1] is the price history
    const currentPrice = product.stats?.current?.[1] || 0;
    const lowestPrice = product.stats?.buyBoxStats?.avg || currentPrice;
    const highestPrice = product.stats?.buyBoxStats?.max || currentPrice;

    // Parse price history (Keepa returns [timestamp, price, timestamp, price...])
    const priceHistory: { date: string; price: number }[] = [];
    for (let i = 0; i < csvData.length; i += 2) {
      if (csvData[i] && csvData[i + 1]) {
        priceHistory.push({
          date: new Date(csvData[i] * 60000).toISOString(),
          price: csvData[i + 1] / 100, // Convert cents to dollars
        });
      }
    }

    return {
      asin,
      title: product.title || "Unknown Product",
      imageUrl: product.images?.[0] || "",
      currentPrice: currentPrice / 100,
      lowestPrice: lowestPrice / 100,
      highestPrice: highestPrice / 100,
      currency: product.currency || "USD",
      lastUpdated: new Date().toISOString(),
      url: `https://www.amazon.com/dp/${asin}`,
      priceHistory: priceHistory.slice(-30), // Last 30 data points
    };
  } catch (error) {
    console.error("Failed to fetch product data:", error);
    return null;
  }
}

// Demo products for testing
function getDemoProducts(): TrackedProduct[] {
  return [
    {
      id: "demo-1",
      asin: "B08N5WRWNW",
      title: "Sony WH-1000XM4 Headphones (Demo)",
      imageUrl: "https://m.media-amazon.com/images/I/71o8Q5XJ4XL._AC_SL1500_.jpg",
      currentPrice: 278.00,
      lowestPrice: 248.00,
      highestPrice: 349.99,
      targetPrice: 250.00,
      currency: "USD",
      lastUpdated: new Date().toISOString(),
      url: "https://www.amazon.com/dp/B08N5WRWNW",
      priceHistory: [
        { date: new Date(Date.now() - 7 * 86400000).toISOString(), price: 298.00 },
        { date: new Date(Date.now() - 5 * 86400000).toISOString(), price: 278.00 },
        { date: new Date(Date.now() - 3 * 86400000).toISOString(), price: 278.00 },
        { date: new Date(Date.now() - 1 * 86400000).toISOString(), price: 278.00 },
      ],
    },
    {
      id: "demo-2",
      asin: "B09V3KXJPB",
      title: "Apple MacBook Air M2 (Demo)",
      imageUrl: "https://m.media-amazon.com/images/I/71f5Eu5lJSL._AC_SL1500_.jpg",
      currentPrice: 1199.00,
      lowestPrice: 1099.00,
      highestPrice: 1299.00,
      targetPrice: 1100.00,
      currency: "USD",
      lastUpdated: new Date().toISOString(),
      url: "https://www.amazon.com/dp/B09V3KXJPB",
      priceHistory: [
        { date: new Date(Date.now() - 7 * 86400000).toISOString(), price: 1249.00 },
        { date: new Date(Date.now() - 5 * 86400000).toISOString(), price: 1199.00 },
        { date: new Date(Date.now() - 3 * 86400000).toISOString(), price: 1199.00 },
        { date: new Date(Date.now() - 1 * 86400000).toISOString(), price: 1199.00 },
      ],
    },
    {
      id: "demo-3",
      asin: "B08GJQ44BJ",
      title: "Samsung 49\" Odyssey G9 Monitor (Demo)",
      imageUrl: "https://m.media-amazon.com/images/I/81Zt42jCg+L._AC_SL1500_.jpg",
      currentPrice: 1099.99,
      lowestPrice: 899.99,
      highestPrice: 1499.99,
      targetPrice: 950.00,
      currency: "USD",
      lastUpdated: new Date().toISOString(),
      url: "https://www.amazon.com/dp/B08GJQ44BJ",
      priceHistory: [
        { date: new Date(Date.now() - 7 * 86400000).toISOString(), price: 1199.99 },
        { date: new Date(Date.now() - 5 * 86400000).toISOString(), price: 1099.99 },
        { date: new Date(Date.now() - 3 * 86400000).toISOString(), price: 1099.99 },
        { date: new Date(Date.now() - 1 * 86400000).toISOString(), price: 1099.99 },
      ],
    },
  ];
}

// GET - List all tracked products
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action");

    // Return demo products if Keepa not configured
    const useDemo = !KEEPA_TOKEN || trackedProducts.length === 0;

    if (action === "alerts") {
      // Check for price drops
      const alerts = trackedProducts
        .filter(p => p.currentPrice <= p.targetPrice)
        .map(p => ({
          product: p.title,
          currentPrice: p.currentPrice,
          targetPrice: p.targetPrice,
          url: p.url,
        }));

      return NextResponse.json({
        success: true,
        alerts,
        demo: useDemo,
      });
    }

    // Return tracked products
    const products = useDemo ? getDemoProducts() : trackedProducts;

    return NextResponse.json({
      success: true,
      products: products.slice(0, 10), // Max 10 products
      count: products.length,
      demo: useDemo,
      maxProducts: 10,
      setupInstructions: !KEEPA_TOKEN ? [
        "1. Sign up at https://keepa.com/#!api",
        "2. Get your API token",
        "3. Add KEEPA_API_KEY to .env.local",
      ] : undefined,
    });
  } catch (error) {
    console.error("Price tracker error:", error);
    return NextResponse.json(
      { error: "Failed to fetch price data", details: String(error) },
      { status: 500 }
    );
  }
}

// POST - Add or update product
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, asin, targetPrice } = body;

    if (action === "add" && asin) {
      // Check if already at max
      if (trackedProducts.length >= 10) {
        return NextResponse.json(
          { error: "Maximum 10 products allowed" },
          { status: 400 }
        );
      }

      // Check if already tracking
      const existing = trackedProducts.find(p => p.asin === asin);
      if (existing) {
        return NextResponse.json(
          { error: "Product already tracked", product: existing },
          { status: 400 }
        );
      }

      // Fetch product data
      const productData = await fetchProductData(asin);

      if (!productData) {
        // Add demo product for testing
        const demoProducts = getDemoProducts();
        const demoProduct = demoProducts[Math.floor(Math.random() * demoProducts.length)];
        demoProduct.id = `demo-${Date.now()}`;
        demoProduct.targetPrice = targetPrice || demoProduct.currentPrice * 0.9;
        trackedProducts.push(demoProduct as TrackedProduct);

        return NextResponse.json({
          success: true,
          product: demoProduct,
          demo: true,
          message: "Added demo product (Keepa API not configured)",
        });
      }

      const newProduct: TrackedProduct = {
        ...productData as TrackedProduct,
        id: `prod-${Date.now()}`,
        targetPrice: targetPrice || (productData.currentPrice || 0) * 0.9,
      };

      trackedProducts.push(newProduct);

      return NextResponse.json({
        success: true,
        product: newProduct,
      });
    }

    if (action === "remove" && asin) {
      trackedProducts = trackedProducts.filter(p => p.asin !== asin);
      return NextResponse.json({ success: true });
    }

    if (action === "update") {
      // Refresh all products
      const updatedProducts = await Promise.all(
        trackedProducts.map(async (product) => {
          const data = await fetchProductData(product.asin);
          if (data) {
            return { ...product, ...data };
          }
          return product;
        })
      );
      trackedProducts = updatedProducts.filter(Boolean) as TrackedProduct[];

      return NextResponse.json({
        success: true,
        products: trackedProducts,
      });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("Price tracker POST error:", error);
    return NextResponse.json(
      { error: "Failed to process request", details: String(error) },
      { status: 500 }
    );
  }
}
