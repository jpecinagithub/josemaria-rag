#!/bin/bash
# Regla de cortafuegos del host necesaria para el puente a Ollama.
#
# El Input del host termina en REJECT y solo acepta puertos concretos.
# El servicio ollama-bridge escucha en la pasarela de la red del proyecto
# (172.30.77.1:11434) y reenvía al 127.0.0.1:11434 donde rag-ollama publica.
# Esta regla acepta SOLO desde la subred del proyecto (172.30.77.0/24) y
# SOLO hacia ese puerto. Idempotente y persistida con netfilter-persistent.
set -e
RULE="-s 172.30.77.0/24 -p tcp --dport 11434 -j ACCEPT"
if sudo iptables -C INPUT $RULE 2>/dev/null; then
  echo "La regla ya existe"
else
  # Insertar justo antes de la regla REJECT final de INPUT
  REJECT_LINE=$(sudo iptables -L INPUT --line-numbers -n | awk '$2=="REJECT"{print $1; exit}')
  sudo iptables -I INPUT "${REJECT_LINE:-13}" $RULE
  echo "Regla insertada en la posición ${REJECT_LINE:-13}"
fi
sudo netfilter-persistent save
echo "Persistida en /etc/iptables/rules.v4"
