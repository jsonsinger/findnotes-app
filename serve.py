# Local test server for FindNotes. Run:  python serve.py
# Then open the address it prints on your phone (same Wi-Fi as this computer).
# Unlike "python -m http.server", it tells the browser never to cache, so the phone
# always gets your latest files instead of a mix of old and new ones.
import http.server
import socket


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def my_address():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))  # nothing is sent, this just picks the network card
        return s.getsockname()[0]
    except OSError:
        return "<this computer's IP>"


PORT = 8000
print(f"On this computer: http://localhost:{PORT}")
print(f"On your phone:    http://{my_address()}:{PORT}")
http.server.ThreadingHTTPServer(("0.0.0.0", PORT), NoCache).serve_forever()
