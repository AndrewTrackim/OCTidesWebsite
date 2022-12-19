f = open("tides.csv", 'r')
height = []
time = []
midnight_passed = False
for x in f:
    parts = x.split(',')
    print(parts)
    print(parts[1][0:len(parts[1]) - 2])
    height.append(float(parts[1][0:len(parts[1]) - 2]))
    time.append('2022.12.19 ' + parts[0] + ":00")

print(height)
print(time)

