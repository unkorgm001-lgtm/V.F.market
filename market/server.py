import http.server
import socketserver
import json
import os
import socket
import uuid
from urllib.parse import urlparse

PORT = 8000
ROOT = os.path.dirname(os.path.abspath(__file__))
SESSIONS = {}

def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

def read_txt(filename):
    path = os.path.join(ROOT, filename)
    if not os.path.exists(path):
        return ""
    with open(path, "r", encoding="utf-8") as f:
        return f.read()

def write_txt(filename, content):
    path = os.path.join(ROOT, filename)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

def parse_users():
    users = []
    for line in read_txt("users.txt").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = [p.strip() for p in line.split("|")]
        if len(parts) >= 3:
            users.append({"username": parts[0], "password": parts[1], "role": parts[2]})
    return users

def parse_products():
    items = []
    for line in read_txt("products.txt").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = [p.strip() for p in line.split("|")]
        if len(parts) >= 6:
            items.append({
                "id": parts[0],
                "name": parts[1],
                "category": parts[2],
                "price": float(parts[3]),
                "stock": int(parts[4]),
                "image": parts[5]
            })
    return items

def save_products(items):
    lines = [f"{p['id']} | {p['name']} | {p['category']} | {float(p['price']):.2f} | {int(p['stock'])} | {p['image']}" for p in items]
    write_txt("products.txt", "\n".join(lines) + "\n")

def parse_sales():
    rows = []
    for line in read_txt("sales.txt").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = [p.strip() for p in line.split("|")]
        if len(parts) >= 7:
            rows.append({
                "saleId": parts[0],
                "date": parts[1],
                "buyer": parts[2],
                "productId": parts[3],
                "productName": parts[4],
                "qty": int(parts[5]),
                "total": float(parts[6])
            })
    return rows

def save_sales(rows):
    lines = [f"{s['saleId']} | {s['date']} | {s['buyer']} | {s['productId']} | {s['productName']} | {int(s['qty'])} | {float(s['total']):.2f}" for s in rows]
    write_txt("sales.txt", "\n".join(lines) + "\n")

def save_users(users):
    lines = [f"{u['username']} | {u['password']} | {u['role']}" for u in users]
    write_txt("users.txt", "\n".join(lines) + "\n")

class BlueMartHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def send_json(self, code, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def get_session(self):
        token = self.headers.get("Authorization", "").replace("Bearer ", "").strip()
        return SESSIONS.get(token)

    def read_json_body(self):
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        raw = self.rfile.read(length).decode("utf-8")
        return json.loads(raw)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        # Block direct raw .txt access from URL
        if path.endswith(".txt"):
            return self.send_json(403, {"error": "Direct .txt access blocked"})

        if path == "/api/state":
            user = self.get_session()
            if not user:
                return self.send_json(401, {"error": "Unauthorized"})
            role = user["role"]
            prods = parse_products()
            if role == "customer":
                safe_prods = [{
                    "id": p["id"],
                    "name": p["name"],
                    "category": p["category"],
                    "price": p["price"],
                    "inStock": p["stock"] > 0,
                    "image": p["image"]
                } for p in prods]
                return self.send_json(200, {"user": user, "products": safe_prods})

            resp = {"user": user, "products": prods, "sales": parse_sales()}
            if role == "orgunk":
                resp["users"] = parse_users()
            return self.send_json(200, resp)

        if path.startswith("/api/"):
            return self.send_json(404, {"error": "API route not found"})

        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        try:
            data = self.read_json_body()
        except Exception:
            return self.send_json(400, {"error": "Invalid JSON body"})

        if path == "/api/login":
            u = data.get("username", "").strip().lower()
            p = data.get("password", "").strip()
            for acc in parse_users():
                if acc["username"].lower() == u and acc["password"] == p:
                    token = str(uuid.uuid4())
                    session_user = {"username": acc["username"], "role": acc["role"]}
                    SESSIONS[token] = session_user
                    return self.send_json(200, {"token": token, "user": session_user})
            return self.send_json(401, {"error": "Invalid username or password"})

        user = self.get_session()
        if not user:
            return self.send_json(401, {"error": "Session expired. Please sign in again."})
        role = user["role"]

        if path == "/api/checkout":
            items = data.get("items", [])
            date_str = data.get("date", "")
            if not items:
                return self.send_json(400, {"error": "Cart is empty"})
            prods = parse_products()
            sales = parse_sales()
            prod_map = {p["id"]: p for p in prods}
            out_of_stock_alerts = []

            for item in items:
                pid = item.get("id")
                qty = int(item.get("qty", 0))
                p = prod_map.get(pid)
                if not p or qty <= 0 or p["stock"] < qty:
                    return self.send_json(400, {"error": f"Insufficient stock for {pid}"})

            counter = 1001 + len(sales)
            for item in items:
                p = prod_map[item["id"]]
                qty = int(item["qty"])
                p["stock"] -= qty
                if p["stock"] == 0:
                    out_of_stock_alerts.append(dict(p))
                sales.append({
                    "saleId": f"SALE-{counter}",
                    "date": date_str,
                    "buyer": user["username"],
                    "productId": p["id"],
                    "productName": p["name"],
                    "qty": qty,
                    "total": round(p["price"] * qty, 2)
                })
                counter += 1

            save_products(prods)
            save_sales(sales)
            return self.send_json(200, {"success": True, "outOfStock": out_of_stock_alerts})

        if path == "/api/products/save":
            if role not in ("orgunk", "admin"):
                return self.send_json(403, {"error": "Permission denied"})
            prods = parse_products()
            pid = data.get("id", "").strip().upper()
            name = data.get("name", "").strip()
            cat = data.get("category", "General").strip()
            price = float(data.get("price", 0))
            stock = int(data.get("stock", 0))
            image = data.get("image", "").strip() or "https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=600&q=80"

            if not pid or not name:
                return self.send_json(400, {"error": "Product ID and Name required"})

            restocked_item = None
            existing = next((p for p in prods if p["id"] == pid), None)
            if existing:
                old_stock = existing["stock"]
                existing["name"] = name
                existing["category"] = cat
                existing["price"] = price
                existing["stock"] = stock
                if image:
                    existing["image"] = image
                if stock > old_stock:
                    restocked_item = dict(existing)
            else:
                new_p = {"id": pid, "name": name, "category": cat, "price": price, "stock": stock, "image": image}
                prods.append(new_p)
                if stock > 0:
                    restocked_item = new_p

            save_products(prods)
            return self.send_json(200, {"success": True, "restocked": restocked_item})

        if path == "/api/products/delete":
            if role != "orgunk":
                return self.send_json(403, {"error": "Only orgunk can delete products"})
            pid = data.get("id", "").strip().upper()
            prods = [p for p in parse_products() if p["id"] != pid]
            save_products(prods)
            return self.send_json(200, {"success": True})

        if path == "/api/sales/clear":
            if role != "orgunk":
                return self.send_json(403, {"error": "Only orgunk can clear sales"})
            save_sales([])
            return self.send_json(200, {"success": True})

        if path == "/api/users/add":
            if role != "orgunk":
                return self.send_json(403, {"error": "Only orgunk can manage users"})
            uname = data.get("username", "").strip()
            pw = data.get("password", "").strip()
            urole = data.get("role", "customer").strip()
            if not uname or not pw or urole not in ("orgunk", "admin", "employment", "customer"):
                return self.send_json(400, {"error": "Invalid user fields"})
            users = parse_users()
            if any(u["username"].lower() == uname.lower() for u in users):
                return self.send_json(400, {"error": "Username already exists"})
            users.append({"username": uname, "password": pw, "role": urole})
            save_users(users)
            return self.send_json(200, {"success": True})

        if path == "/api/users/delete":
            if role != "orgunk":
                return self.send_json(403, {"error": "Only orgunk can delete users"})
            uname = data.get("username", "").strip()
            if uname.lower() == "orgunk":
                return self.send_json(400, {"error": "Cannot delete owner orgunk"})
            users = [u for u in parse_users() if u["username"].lower() != uname.lower()]
            save_users(users)
            return self.send_json(200, {"success": True})

        return self.send_json(404, {"error": "API route not found"})

if __name__ == "__main__":
    ip = get_local_ip()
    print("=" * 54)
    print(" BlueMart Python Local Server Running // ORG | UNK")
    print(f" PC URL:    http://localhost:{PORT}")
    print(f" Phone URL: http://{ip}:{PORT}")
    print("=" * 54)
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(("0.0.0.0", PORT), BlueMartHandler) as httpd:
        httpd.serve_forever()
