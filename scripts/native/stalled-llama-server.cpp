#include <chrono>
#include <cstdio>
#include <thread>

int llama_server(int, char **) {
    std::puts("entered");
    std::fflush(stdout);
    while (true) {
        std::this_thread::sleep_for(std::chrono::hours(1));
    }
}
