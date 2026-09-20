#include <stdio.h>
#include "util.h"

int main(void)
{
    // TODO: 添加欢迎语
    int result = add(2, 3);
    printf("hello-cb: 2 + 3 = %d\n", result);

    // FIXME (1) dev: 2026-09-20 这里有个潜在的内存问题待检查
    return 0;
}
