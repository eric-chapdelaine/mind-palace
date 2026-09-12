# Workers

Workers perform expensive or device-specific work without direct SQLite access.

V0 includes `cp-sat`, a local JSON-in/JSON-out Python process. Future OpenCode workers on trusted laptops should use a pull-based HTTP protocol with capability registration, heartbeats, leases, and hard availability constraints. All machines are owner-operated, but leases and credentials remain necessary for correctness and endpoint protection.
