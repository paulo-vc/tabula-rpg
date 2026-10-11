// Evita abrir uma janela de console extra no Windows em builds de release. NÃO REMOVER.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tabularium_lib::run();
}
