#!/bin/bash
# Install BedrockConnect + DNS hijack on a public VPS.
# Run as root (or via sudo) on Ubuntu 24.04+/Debian 12+.
set -e

VPS_IP=82.25.85.219
LAB_IP=159.2.5.138

# 1. Packages
apt-get update
apt-get install -y dnsmasq openjdk-21-jre-headless wget

# 2. dnsmasq — bind only to public IP so systemd-resolved keeps loopback :53
cat >/etc/dnsmasq.conf <<EOF
no-resolv
server=1.1.1.1
server=1.0.0.1
listen-address=$VPS_IP
bind-interfaces
address=/hivebedrock.network/$VPS_IP
address=/mco.lbsg.net/$VPS_IP
address=/mco.mineplex.com/$VPS_IP
address=/mco.cubecraft.net/$VPS_IP
address=/play.galaxite.net/$VPS_IP
address=/mco.pixelparadise.gg/$VPS_IP
address=/play.inpvp.net/$VPS_IP
address=/play.pixelparadise.gg/$VPS_IP
log-queries
log-facility=/var/log/dnsmasq.log
EOF
systemctl enable --now dnsmasq
systemctl restart dnsmasq

# 3. BedrockConnect
mkdir -p /opt/bedrockconnect
wget -qO /opt/bedrockconnect/BedrockConnect.jar \
  https://github.com/Pugmatt/BedrockConnect/releases/latest/download/BedrockConnect-1.0-SNAPSHOT.jar

cat >/opt/bedrockconnect/servers.json <<EOF
[
  {"name":"Greg's","iconUrl":"","address":"$LAB_IP","port":19132},
  {"name":"The Journey is real","iconUrl":"","address":"$LAB_IP","port":19200}
]
EOF

cat >/etc/systemd/system/bedrockconnect.service <<'EOF'
[Unit]
Description=BedrockConnect
After=network.target

[Service]
WorkingDirectory=/opt/bedrockconnect
ExecStart=/usr/bin/java -jar /opt/bedrockconnect/BedrockConnect.jar nodb=true port=19132 server-limit=20 custom_servers=/opt/bedrockconnect/servers.json featured_servers=false user_servers=false
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now bedrockconnect

# 4. Firewall
ufw allow 53/udp
ufw allow 19132/udp

# 5. Status
sleep 3
echo "=== Listening ports ==="
ss -ulpn | grep -E ":(53|19132)\b"
echo "=== BedrockConnect status ==="
systemctl status bedrockconnect --no-pager | head -10
